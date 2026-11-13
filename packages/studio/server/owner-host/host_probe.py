#!/usr/bin/env python3
"""Bounded metadata-only source-host probe. No SQLite writes; no message bodies."""
import hashlib
import json
import os
import re
import selectors
import socket
import sqlite3
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlsplit
try:
    import tomllib
except ImportError:
    tomllib = None


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(b):
    return hashlib.sha256(b).hexdigest()


def bounded(path, limit=2097152, private=False):
    p = Path(path)
    require(p.is_absolute(), "nonabsolute server-owned evidence path")
    before = p.lstat()
    require(stat.S_ISREG(before.st_mode) and not p.is_symlink(), "evidence is not a regular file")
    if private:
        require(before.st_uid in (0, os.getuid()) and before.st_mode & 0o077 == 0, "evidence must be server-owned 0600")
    require(before.st_size <= limit, "evidence file exceeds read bound")
    with p.open("rb") as f:
        b = f.read(limit + 1)
    after = p.stat()
    require(len(b) <= limit and (before.st_ino, before.st_mtime_ns, before.st_size) == (after.st_ino, after.st_mtime_ns, after.st_size), "evidence changed during read")
    return b


class Native:
    def __init__(self, paths):
        self.connections = []
        for attr, name in [("threads", "threadsDb"), ("history", "historyDb"), ("queue", "queueDb"), ("schedule", "scheduleDb")]:
            path = paths[name]
            require(Path(path).is_absolute() and Path(path).is_file(), "missing exact native metadata DB")
            c = sqlite3.connect("file:" + quote(path, safe="/") + "?mode=ro", uri=True, timeout=0.25)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA query_only=ON")
            setattr(self, attr, c)
            self.connections.append(c)

    def close(self):
        for c in self.connections:
            c.close()

    def query(self, connection, sql, params=()):
        deadline = time.monotonic() + 1.5
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        return connection.execute(sql, params)

    def metadata(self, tid):
        r = self.query(self.threads, "SELECT id, model_provider, model, reasoning_effort, approval_mode, sandbox_policy, cwd, originator FROM threads WHERE id = ?", (tid,)).fetchone()
        require(r is not None, "missing exact native thread metadata")
        return dict(r)

    def lifecycle(self, tid):
        latest = self.query(self.history, "SELECT thread_id, turn_id, status, started_at, completed_at, duration_ms FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1", (tid,)).fetchone()
        require(latest is not None, "unknown native current turn")
        latest = dict(latest)
        require(latest["status"] in ("inProgress", "completed", "interrupted", "failed", "cancelled"), "unknown native current turn status")
        active = self.query(self.history, "SELECT turn_id FROM thread_turns WHERE thread_id = ? AND status = 'inProgress' LIMIT 2", (tid,)).fetchall()
        require(len(active) <= 1, "multiple active native turns")
        if latest["status"] == "inProgress":
            require(len(active) == 1 and active[0][0] == latest["turn_id"] and latest["completed_at"] is None, "inconsistent active native turn")
        else:
            require(not active and latest["completed_at"] is not None, "native current turn is not genuinely settled")
        return latest

    def tree(self, root, bound):
        ids = [root]
        workers = []
        for parent in ids:
            rows = self.query(self.threads, "SELECT id, source FROM threads WHERE source LIKE ? LIMIT ?", ("%" + parent + "%", bound + 1)).fetchall()
            require(len(rows) <= bound, "descendant candidate bound exceeded")
            for row in rows:
                try:
                    source = json.loads(row["source"])
                except (TypeError, json.JSONDecodeError):
                    raise ValueError("unknown descendant source metadata")
                if isinstance(source, dict) and source.get("subagent", {}).get("thread_spawn", {}).get("parent_thread_id") == parent:
                    require(row["id"] not in ids, "cyclic native descendant tree")
                    ids.append(row["id"])
                    require(len(ids) - 1 <= bound, "descendant bound exceeded")
                    workers.append(self.lifecycle(row["id"]))
        pending = []
        for tid in ids:
            rows = self.query(self.queue, "SELECT id, thread_id, queue_order, created_at_ms, updated_at_ms FROM queued_items WHERE thread_id = ? ORDER BY queue_order LIMIT 2", (tid,)).fetchall()
            pending.extend(dict(r) for r in rows)
        return {"currentTurn": self.lifecycle(root), "workers": workers, "pending": pending}


def supported_pair(model, effort):
    return (model, effort) in (("gpt-6.1-sol", "max"), ("gpt-6.1-sol", "xhigh"), ("gpt-6.1-terra", "ultra"))


def selected_tier(selected):
    require(selected.get("serviceTier") in ("standard", "fast"), "unsupported selected service tier")
    return "default" if selected["serviceTier"] == "standard" else "fast"


def runtime(metadata, expected_cwd, model="gpt-6.1-sol", effort="max"):
    require(supported_pair(model, effort), "unsupported configured model/effort pair")
    require(metadata["model_provider"] == "openai" and metadata["model"] == model and metadata["reasoning_effort"] == effort, "native model/provider/effort differs")
    require(metadata["approval_mode"] == "never" and metadata["cwd"] == expected_cwd, "native access/cwd differs")
    try:
        sandbox = json.loads(metadata["sandbox_policy"])
    except (TypeError, json.JSONDecodeError):
        sandbox = {}
    require(sandbox.get("type") in ("disabled", "danger-full-access"), "native Full access is not established")


def bb_command(config):
    executable = config["executable"]
    require(isinstance(executable, str) and Path(executable).is_absolute() and Path(executable).is_file(), "missing supported BB executable")
    command = [executable]
    if "node" in config:
        node = config["node"]
        require(isinstance(node, str) and Path(node).is_absolute() and Path(node).is_file() and os.access(node, os.X_OK), "missing pinned BB Node executable")
        command.insert(0, node)
    overrides = config.get("environment", config.get("env", {}))
    require(not ("environment" in config and "env" in config) or config["environment"] == config["env"], "conflicting BB transport environment aliases")
    require(isinstance(overrides, dict) and set(overrides) <= {"BB_SERVER_URL", "BB_HOST_DAEMON_PORT"}, "unsupported BB transport environment field")
    if overrides:
        require(set(overrides) == {"BB_SERVER_URL", "BB_HOST_DAEMON_PORT"} and all(isinstance(v, str) for v in overrides.values()), "incomplete BB transport environment")
        require(not re.search(r"\s", overrides["BB_SERVER_URL"]), "BB server URL is not an exact loopback source proxy")
        url = urlsplit(overrides["BB_SERVER_URL"])
        require(url.scheme == "http" and url.hostname in ("127.0.0.1", "::1") and url.username is None and url.password is None and url.port is not None and 1 <= url.port <= 65535 and url.path in ("", "/") and not url.query and not url.fragment, "BB server URL is not an exact loopback source proxy")
        port = overrides["BB_HOST_DAEMON_PORT"]
        require(re.fullmatch(r"[1-9][0-9]{0,4}", port) and int(port) <= 65535, "invalid BB host daemon port")
    # Only these nonsecret transport overrides are merged into the existing
    # process environment. The private config pins both executable paths.
    return command, {**os.environ, **overrides}


def bb_call(config, args):
    command, environment = bb_command(config)
    # No shell, caller arguments, credential reads or copied authentication.
    process = subprocess.Popen(command + args, env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        output = bytearray()
        deadline = time.monotonic() + 10.0
        os.set_blocking(process.stdout.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            eof = False
            while True:
                require(time.monotonic() < deadline, "BB metadata read timed out")
                ready = selector.select(min(0.1, max(0, deadline - time.monotonic())))
                if not ready and process.poll() is None:
                    continue
                # Drain each readiness edge. Kqueue can combine data and EOF
                # into one edge; waiting for a second EOF edge can time out.
                while True:
                    require(time.monotonic() < deadline, "BB metadata read timed out")
                    try:
                        chunk = os.read(process.stdout.fileno(), min(65536, 131073-len(output)))
                    except BlockingIOError:
                        break
                    if not chunk:
                        eof = True
                        break
                    output.extend(chunk)
                    require(len(output) <= 131072, "BB metadata response exceeds bound")
                if eof:
                    break
        process.wait(timeout=max(0.01, deadline - time.monotonic()))
        require(process.returncode == 0, "supported BB metadata read failed")
        return json.loads(output)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def owner_metadata(config, target, selected):
    # This protected BB SDK projection never calls the native Studio controller.
    # Two bounded snapshots avoid a CLI startup for each pinned event.
    snapshot = bb_call(config, ["plugin", "rpc", "call", "reel-studio", "ownerMetadataEvidence", "--json"])
    require(isinstance(snapshot, dict) and snapshot.get("schema") == "reel-bb-owner-metadata/v1", "unknown protected BB owner metadata schema")
    require(isinstance(snapshot.get("thread"), dict) and isinstance(snapshot.get("environment"), dict), "missing protected BB thread/environment metadata")
    defaults = snapshot.get("acceptedDefaults")
    require(isinstance(defaults, dict) and set(defaults) == {"model", "reasoningLevel", "permissionMode", "serviceTier", "source"}, "missing exact accepted BB defaults")
    require(defaults["model"] == selected["model"] and defaults["reasoningLevel"] == selected["effort"] and defaults["permissionMode"] == "full" and defaults["serviceTier"] == selected_tier(selected) and defaults["source"] in ("client/thread/start", "client/turn/requested", "client/turn/start"), "accepted BB defaults differ")
    events = snapshot.get("events")
    require(isinstance(events, list) and len(events) <= 401, "protected BB metadata event bound exceeded")
    ids, sequences = set(), set()
    for e in events:
        require(isinstance(e, dict) and isinstance(e.get("id"), str) and 0 < len(e["id"]) <= 200 and isinstance(e.get("type"), str) and 0 < len(e["type"]) <= 200 and type(e.get("seq")) is int and e["seq"] > 0 and isinstance(e.get("data"), dict), "invalid protected BB metadata event")
        require(e.get("threadId") == target, "protected BB metadata event belongs to another thread")
        require(e["id"] not in ids and e["seq"] not in sequences, "duplicate protected BB metadata event identity")
        ids.add(e["id"])
        sequences.add(e["seq"])
    return snapshot


def event(snapshot, target, pin, kind):
    require(type(pin.get("seq")) is int and pin["seq"] > 0 and isinstance(pin.get("eventId"), str), "missing exact BB metadata event sequence")
    events = [e for e in snapshot["events"] if e["id"] == pin["eventId"] or e["seq"] == pin["seq"]]
    require(len(events) == 1, "missing exact BB event")
    e = events[0]
    require(e.get("type") == kind and e.get("seq") == pin["seq"] and e.get("id") == pin["eventId"] and e.get("threadId") == target, "BB event identity differs")
    return e


def accepted_events(snapshot, target, binding):
    request = event(snapshot, target, binding["request"], "client/turn/requested")
    identity = event(snapshot, target, binding["identity"], "thread/identity")
    accepted = event(snapshot, target, binding["accepted"], "turn/input/accepted")
    require(not any(e["type"] == "provider/modelFallback" and e["seq"] >= request["seq"] for e in snapshot["events"]), "BB provider/model fallback occurred after the pinned request")
    return request, identity, accepted


def legacy_retirement(config, state):
    pin = config.get("legacyAdmission", {})
    keys = {"schema", "operationId", "projectId", "requestKey", "originalArgsFingerprint", "expectedRevision", "expectedGeneration", "legacyAdmission", "loadedEntrySHA256"}
    require(isinstance(pin, dict) and set(pin) == keys and pin.get("schema") == "reel-legacy-admission-pin/v1" and pin.get("legacyAdmission") == "managed-project-cas-v1", "missing exact legacy admission pin")
    require(all(re.fullmatch(r"[a-f0-9]{64}", pin.get(k, "")) for k in ("operationId", "originalArgsFingerprint", "loadedEntrySHA256")), "invalid legacy admission fingerprint")
    lines = [line for line in state.get("productionLines", []) if line.get("id") == config["lineId"]]
    require(len(lines) == 1, "missing exact legacy direction")
    line = lines[0]
    owner = {"lineId": line["id"], "generation": line["generation"], "ownerHost": line["ownerHost"], "ownerThreadId": line["ownerThreadId"], "bbThreadId": line["ownerRuntime"]["bbThreadId"]}
    require(pin["expectedGeneration"] == line["generation"], "legacy generation differs")
    proof = bb_call(config["bb"], ["plugin", "rpc", "call", "reel-studio", "legacyOperationEvidence", "--json"])
    require(isinstance(proof, dict) and proof.get("owner") == owner and isinstance(proof.get("operations"), list) and len(proof["operations"]) <= 512, "missing protected BB legacy operation evidence")
    operations = [operation for operation in proof["operations"] if operation.get("operationId") == pin["operationId"]]
    require(len(operations) == 1, "missing exact durable BB legacy operation")
    operation = operations[0]
    require(operation.get("operation") == "generate" and operation.get("state") == "possibly_delivered" and operation.get("neverReplay") is True and operation.get("owner") == owner, "legacy operation is not the exact unresolved Generate owner")
    require(all(operation.get(k) == pin[k] for k in ("operationId", "projectId", "requestKey", "originalArgsFingerprint", "expectedRevision")), "legacy original admission arguments differ")
    handoff = line.get("handoffs", [])[-1] if line.get("handoffs") else {}
    historical_runtime = handoff.get("nextOwner", {}).get("runtime", {})
    require(operation.get("transferId") == handoff.get("transferId") and operation.get("execution") == historical_runtime and historical_runtime.get("model") == "gpt-6.1-sol" and historical_runtime.get("effort") == "max", "legacy admission is not the retained original Sol/max execution")
    info = proof.get("runtimeInfo", {})
    require(info.get("version") == "0.1.32" and info.get("ownerProtocol") == 2 and info.get("platform") == "linux" and info.get("hostname") == config["hostname"] and info.get("loadedEntrySHA256") == pin["loadedEntrySHA256"], "legacy currently loaded native admission code differs")
    return {**{k: pin[k] for k in ("operationId", "projectId", "requestKey", "originalArgsFingerprint", "expectedRevision", "expectedGeneration", "legacyAdmission")}, "legacyEntrySHA256": info["loadedEntrySHA256"]}


def retained_local_job(config, state, job_id, native):
    require(isinstance(job_id, str) and re.fullmatch(r"[0-9a-fA-F-]{36}", job_id), "invalid retained local job UUID")
    matches = [(p, j) for p in state.get("projects", []) for j in p.get("jobs", []) if j.get("id") == job_id]
    require(len(matches) == 1, "retained local job is missing or ambiguous")
    project, job = matches[0]
    lines = [line for line in state.get("productionLines", []) if line.get("id") == config["lineId"]]
    require(len(lines) == 1, "retained local direction is missing")
    line = lines[0]
    owner = {"lineId": line["id"], "generation": line["generation"], "ownerHost": line["ownerHost"], "ownerThreadId": line["ownerThreadId"], "bbThreadId": line["ownerRuntime"]["bbThreadId"]}
    require(project.get("productionLineId") == line["id"] and job.get("lineId") == line["id"] and job.get("lineGeneration") == line["generation"] and job.get("lineOwner") == owner, "retained local job owner differs")
    execution = job.get("execution", {})
    require(not job.get("external") and job.get("status") == "uncertain" and not job.get("versionId") and job.get("computeTarget") == line["ownerHost"] and execution == line["ownerRuntime"], "retained job is not the exact uncertain local admission")
    require(job.get("model") == execution.get("model") and job.get("effort") == execution.get("effort") and job.get("modelProvider") == execution.get("provider"), "retained local execution fields differ")
    worker = job.get("threadId")
    require(isinstance(worker, str) and worker == job.get("executorThreadId") and worker not in (config["target"]["nativeThreadId"], config["source"]["threadId"]), "retained worker is not distinct from the coordinators")
    job_dir = Path(config["paths"]["state"]).parent / "jobs" / job_id
    require(job.get("dir") == str(job_dir) and job_dir.is_dir() and not job_dir.is_symlink(), "retained worker directory differs from the original job")
    metadata = native.metadata(worker)
    runtime(metadata, str(job_dir), execution.get("model"), execution.get("effort"))
    require(metadata["originator"] == "reel-studio", "retained worker is not an original Studio execution")
    tree = native.tree(worker, config.get("maxDescendants", 32))
    turn = tree["currentTurn"]
    require(turn["turn_id"] == job.get("turnId") and turn["status"] == "completed" and turn["completed_at"] is not None, "retained native worker is not the exact completed turn")
    require(all(w["status"] != "inProgress" for w in tree["workers"]) and not tree["pending"], "retained native worker descendants or queue are not settled")
    observation = {"metadata": metadata, "tree": tree}
    proof = {"projectId": project["id"], "jobId": job_id, "nativeThreadId": worker, "nativeTurnId": turn["turn_id"], "nativeFingerprint": digest(json.dumps(observation, sort_keys=True, separators=(",", ":")).encode())}
    return proof, observation


def probe(config, call):
    source, target, paths = config["source"], config["target"], config["paths"]
    require(config.get("schema") == "reel-source-host-authority/v1", "unknown authority config schema")
    require(tomllib is not None, "Python 3.11+ TOML parser is required")
    require(isinstance(config.get("maxDescendants", 32), int) and 0 <= config.get("maxDescendants", 32) <= 64, "invalid descendant bound")
    require(socket.gethostname() == config["hostname"], "authority is executing on another host")
    require(config["bb"]["hostId"] == target["hostId"], "host binding configuration differs")
    selected = target["runtime"]
    require(supported_pair(selected.get("model"), selected.get("effort")), "unsupported configured model/effort pair")
    require(selected == {"kind": "bb", "bbThreadId": target["bbThreadId"], "nativeThreadId": target["nativeThreadId"], "host": target["ownerHost"], "provider": "openai", "model": selected["model"], "effort": selected["effort"], "permissionMode": "full-access", "serviceTier": "standard" if selected_tier(selected) == "default" else "fast", "cwd": target["environmentDirectory"]}, "configured runtime does not match independent verification policy")
    native = Native(paths)
    try:
        schedule_bytes = bounded(source["schedule"]["path"], 65536)
        schedule = tomllib.loads(schedule_bytes.decode())
        pin = source["schedule"]
        require(digest(schedule_bytes) == pin["pausedSha256"], "exact paused schedule fingerprint changed")
        require(schedule.get("status") == "PAUSED" and schedule.get("id") == pin["id"] and schedule.get("kind") == "heartbeat" and schedule.get("target_thread_id") == source["threadId"] and schedule.get("rrule") == pin["rrule"] and digest(schedule.get("prompt", "").encode()) == pin["promptSha256"], "exact source schedule is not paused/preserved")
        schedule_query = "SELECT id, account_id, user_id, installation_id, legacy_automation_id, kind, target_thread_id, status, next_run_at FROM automations WHERE id = ? OR legacy_automation_id = ? LIMIT 3"
        rows = native.query(native.schedule, schedule_query, (pin["id"], pin["id"])).fetchall()
        require(len(rows) == 1 and rows[0]["id"] == pin["id"] and all(rows[0][k] is None for k in ("account_id", "user_id", "installation_id", "legacy_automation_id")), "schedule is not the exact local legacy branch")
        require(rows[0]["kind"] == "heartbeat" and rows[0]["target_thread_id"] == source["threadId"], "native schedule target differs")
        source_metadata = native.metadata(source["threadId"])
        runtime(source_metadata, source["nativeCwd"])
        source_tree = native.tree(source["threadId"], config.get("maxDescendants", 32))
        require(source_tree["currentTurn"]["status"] != "inProgress" and all(w["status"] != "inProgress" for w in source_tree["workers"]), "source current turn or descendants are active")
        require(not source_tree["pending"], "source or descendant has a queued continuation")

        state_bytes = bounded(paths["state"], 33554432)
        require(re.fullmatch(r"[a-f0-9]{64}", call.get("stateFileSha256", "")) and digest(state_bytes) == call["stateFileSha256"], "original state bytes changed since locked Store read")
        canonical_bytes = bounded(paths["canonical"], 2097152)
        text = canonical_bytes.decode()
        revisions = re.findall(r"(?m)^revision:\s*(\d+)\s*$", text)
        sections = re.findall(r"(?ms)^## ONE next_action\s*\n(.*?)(?=^## |\Z)", text)
        require(len(revisions) == 1 and len(sections) == 1 and 0 < len(sections[0].strip()) <= 16000, "canonical revision/ONE next_action is unknown or ambiguous")
        canonical = {"path": paths["canonical"], "revision": int(revisions[0]), "sha256": digest(canonical_bytes), "nextActionSha256": digest(sections[0].strip().encode())}
        require(canonical["revision"] >= config["canonical"]["minimumRevision"], "canonical checkpoint is obsolete")
        if call["purpose"] == "line_handoff":
            require(canonical["sha256"] == config["canonical"]["handoffSha256"], "canonical checkpoint changed before handoff")

        binding_bytes = bounded(config["bb"]["bindingPath"], 65536, True)
        require(digest(binding_bytes) == config["bb"]["bindingSha256"], "trusted BB binding preimage changed")
        binding = json.loads(binding_bytes)
        require(binding.get("schema") == "reel-bb-host-binding/v1", "unknown BB host binding schema")
        for k in ("bbThreadId", "nativeThreadId", "projectId", "environmentId", "hostId", "hostname", "environmentDirectory"):
            require(binding.get(k) == target.get(k), "BB binding identity/environment differs")
        require(binding.get("providerId") == "codex", "BB provider adapter differs")
        show = owner_metadata(config["bb"], target["bbThreadId"], selected)
        thread, env = show.get("thread", {}), show.get("environment", {})
        require(isinstance(binding.get("threadUpdatedAt"), int) and thread.get("updatedAt") == binding["threadUpdatedAt"], "BB binding is stale for current thread metadata")
        require(thread.get("id") == target["bbThreadId"] and thread.get("projectId") == target["projectId"] and thread.get("environmentId") == target["environmentId"] and thread.get("providerId") == "codex" and not thread.get("deletedAt") and not thread.get("archivedAt"), "current BB thread identity differs")
        require(env.get("id") == target["environmentId"] and env.get("projectId") == target["projectId"] and env.get("hostId") == target["hostId"] and env.get("path") == target["environmentDirectory"] and env.get("status") == "ready" and env.get("hostLifecycle") == "active" and env.get("lifecycle", {}).get("phase") == "active", "current BB environment/host is not ready")
        request, identity, accepted = accepted_events(show, target["bbThreadId"], binding)
        raw_execution = request["data"].get("execution", {})
        execution = {k: raw_execution.get(k) for k in ("model", "reasoningLevel", "permissionMode", "serviceTier")}
        require(execution == binding["request"]["execution"] and execution.get("model") == selected["model"] and execution.get("reasoningLevel") == selected["effort"] and execution.get("permissionMode") == "full" and execution.get("serviceTier") == selected_tier(selected), "accepted BB execution selection differs")
        require(request["data"].get("requestId") == binding["request"]["requestId"] and accepted["data"].get("clientRequestId") == binding["request"]["requestId"] and accepted["data"].get("providerThreadId") == target["nativeThreadId"] and identity["data"].get("providerThreadId") == target["nativeThreadId"], "BB accepted request/native UUID chain differs")
        require(request["createdAt"] == binding["request"]["createdAt"] and request["seq"] < accepted["seq"], "BB request acceptance ordering differs")
        target_metadata = native.metadata(target["nativeThreadId"])
        runtime(target_metadata, target["environmentDirectory"], selected["model"], selected["effort"])
        require(target_metadata["originator"] == "bb", "native UUID is not the genuine BB session")
        target_tree = native.tree(target["nativeThreadId"], config.get("maxDescendants", 32))
        turn = target_tree["currentTurn"]
        require(turn["turn_id"] == binding["nativeTurnId"] and turn["started_at"] * 1000 >= request["createdAt"] - 5000, "BB binding is stale for the actual native turn")
        bb_status = thread.get("runtime", {}).get("displayStatus")
        require(bb_status in ("idle", "active", "running"), "unknown BB lifecycle state")
        settled = turn["status"] != "inProgress" and all(w["status"] != "inProgress" for w in target_tree["workers"]) and not target_tree["pending"] and bb_status == "idle" and thread.get("queuedMessageCount") == 0 and thread.get("activeBackgroundAgentCount") == 0
        result = {"ok": True, "scheduler": {"id": pin["id"], "sha256": digest(schedule_bytes), "status": "PAUSED", "branch": "local-legacy", "nativeCacheStatus": rows[0]["status"], "nativeCacheNextRunAt": rows[0]["next_run_at"]}, "source": {**source_tree, "runtime": source_metadata}, "manifest": canonical, "target": {"bbThreadId": target["bbThreadId"], "nativeThreadId": target["nativeThreadId"], "environmentId": target["environmentId"], "hostId": target["hostId"], "cwd": target["environmentDirectory"], "currentTurn": turn, "workers": target_tree["workers"], "bbStatus": bb_status, "settled": settled, "requestEventId": request["id"], "acceptedEventId": accepted["id"], "selectedServiceTier": selected_tier(selected), "normalizedServiceTier": selected["serviceTier"], "nativeServiceTier": None, "runtime": target_metadata}}
        if call["purpose"] in ("line_runtime_adopt", "line_request_retire"):
            require(all(w["status"] != "inProgress" for w in target_tree["workers"]) and not target_tree["pending"] and thread.get("queuedMessageCount") == 0 and thread.get("activeBackgroundAgentCount") == 0, "maintenance target has active workers or a pending continuation")
        if call["purpose"] == "line_request_retire":
            result["retirement"] = legacy_retirement(config, json.loads(state_bytes))
        retained_observation = None
        if "retainedJobId" in call:
            require(call["purpose"] == "line_runtime_adopt", "only runtime adoption may retain a terminal local job")
            result["retainedJob"], retained_observation = retained_local_job(config, json.loads(state_bytes), call["retainedJobId"], native)
        if call.get("jobId"):
            pin = config.get("reconciliationReceipts", {}).get(call["jobId"])
            if pin:
                receipt_bytes = bounded(pin["path"], 65536, True)
                require(digest(receipt_bytes) == pin["sha256"], "same-job receipt preimage differs")
                receipt = json.loads(receipt_bytes)
                require(receipt.get("schema") == "reel-external-job-readback/v1" and receipt.get("evidence", {}).get("source") == "same-target-readback" and re.fullmatch(r"[a-f0-9]{64}", receipt.get("evidence", {}).get("targetFingerprint", "")), "missing genuine same-target receipt provenance")
                result["reconciliation"] = receipt
        # Re-read mutable files after the metadata roundtrip. DB active/queue state
        # also rechecked; this does not pretend to lock the independent native app.
        require(bounded(source["schedule"]["path"], 65536) == schedule_bytes and bounded(paths["canonical"]) == canonical_bytes and bounded(paths["state"], 33554432) == state_bytes, "source files changed during verification")
        require(native.tree(source["threadId"], config.get("maxDescendants", 32)) == source_tree, "source lifecycle/queue changed during verification")
        require(native.tree(target["nativeThreadId"], config.get("maxDescendants", 32)) == target_tree, "target lifecycle/queue changed during verification")
        require(native.metadata(source["threadId"]) == source_metadata and native.metadata(target["nativeThreadId"]) == target_metadata, "native runtime changed during verification")
        final_rows = native.query(native.schedule, schedule_query, (source["schedule"]["id"], source["schedule"]["id"])).fetchall()
        require([dict(r) for r in final_rows] == [dict(r) for r in rows], "schedule storage branch/cache changed during verification")
        final_show = owner_metadata(config["bb"], target["bbThreadId"], selected)
        for key in ("id", "projectId", "environmentId", "providerId", "deletedAt", "archivedAt", "updatedAt", "runtime", "queuedMessageCount", "activeBackgroundAgentCount"):
            require(final_show.get("thread", {}).get(key) == thread.get(key), "BB lifecycle/queue changed during verification")
        for key in ("id", "projectId", "hostId", "path", "status", "hostLifecycle", "lifecycle"):
            require(final_show.get("environment", {}).get(key) == env.get(key), "BB environment changed during verification")
        require(final_show["acceptedDefaults"] == show["acceptedDefaults"], "accepted BB defaults changed during verification")
        require(accepted_events(final_show, target["bbThreadId"], binding) == (request, identity, accepted), "pinned BB request/identity/acceptance changed during verification")
        if retained_observation is not None:
            final_retained, final_observation = retained_local_job(config, json.loads(state_bytes), call["retainedJobId"], native)
            require(final_observation == retained_observation and final_retained == result["retainedJob"], "retained native worker changed during verification")
        return result
    finally:
        native.close()


def main():
    try:
        config_bytes = bounded(sys.argv[1], 65536, True)
        require(digest(config_bytes) == sys.argv[2], "server config changed; reinstall verifier with reviewed preimage")
        call = json.loads(sys.stdin.buffer.read(8193))
        result = probe(json.loads(config_bytes), call)
        require(bounded(sys.argv[1], 65536, True) == config_bytes, "server config changed during verification")
        print(json.dumps(result, separators=(",", ":")))
    except Exception as e:
        # Deliberately no paths, SQL, raw process output, tokens or evidence bodies.
        message = str(e) if isinstance(e, ValueError) else type(e).__name__ + ": required source metadata unavailable"
        print(json.dumps({"ok": False, "error": message}))


if __name__ == "__main__":
    main()
