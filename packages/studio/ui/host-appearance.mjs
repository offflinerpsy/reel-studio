import {applyDocumentTheme,applyHostStyleVariables,applyHostFonts} from '@modelcontextprotocol/ext-apps';

/** Apply both the initial host context and subsequent partial notifications. */
export function syncHostAppearance(context={}){
  if(context?.theme)applyDocumentTheme(context.theme);
  if(context?.styles?.variables)applyHostStyleVariables(context.styles.variables);
  if(context?.styles?.css?.fonts)applyHostFonts(context.styles.css.fonts);
  if(context?.safeAreaInsets){
    const {top=0,right=0,bottom=0,left=0}=context.safeAreaInsets;
    document.body.style.padding=`${top}px ${right}px ${bottom}px ${left}px`;
  }
}
