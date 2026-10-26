import { createTheme } from '@mui/material/styles';
const palettes = {
  light: { mode: 'light', primary: { main: '#984426', contrastText: '#fffaf1' }, secondary: { main: '#0d6d66' }, background: { default: '#f7f1e6', paper: '#fffaf0' }, text: { primary: '#213b34', secondary: '#59655e' }, divider: '#b7ae9e', success: { main: '#0d6d66' }, error: { main: '#a8322a', contrastText: '#f8f5ee' } },
  dark: { mode: 'dark', primary: { main: '#efb792', contrastText: '#2c211b' }, secondary: { main: '#8bd9cb' }, background: { default: '#241e19', paper: '#302922' }, text: { primary: '#f4ecdc', secondary: '#c9bdab' }, divider: '#776c5e', success: { main: '#8bd9cb' }, error: { main: '#ffb4ab', contrastText: '#351b18' } },
};
export const appTheme = mode => createTheme({
  palette: palettes[mode], shape: { borderRadius: 16 }, spacing: 8,
  typography: { fontFamily: '"Plus Jakarta Sans", Nunito, system-ui, sans-serif', fontSize: 17, body1: { fontSize: '1.125rem', lineHeight: 1.6 }, body2: { fontSize: '1rem', lineHeight: 1.55 }, button: { textTransform: 'none', fontWeight: 800, fontSize: '1rem' }, h1: { fontFamily: 'Georgia, serif', fontSize: '2.5rem', lineHeight: 1.12, fontWeight: 400 }, h2: { fontFamily: 'Georgia, serif', fontSize: '1.8rem', lineHeight: 1.2, fontWeight: 400 }, h3: { fontFamily: '"Plus Jakarta Sans", Nunito, system-ui, sans-serif', fontSize: '1.3rem', lineHeight: 1.3, fontWeight: 700 } },
  components: {
    MuiCssBaseline: { styleOverrides: {
      body: { margin: 0 }, '[hidden]': { display: 'none !important' }, '*': { WebkitTapHighlightColor: 'transparent' }, ':focus-visible': { outline: `3px solid ${palettes[mode].primary.main}`, outlineOffset: 3 },
      '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animation: 'none !important', transition: 'none !important', scrollBehavior: 'auto !important' } },
    } },
    // Theme colours switch together. Fading button ink after the paper changes
    // briefly leaves the old dark ink on the new dark surface.
    MuiButton: { defaultProps: { disableElevation: true, size: 'large' }, styleOverrides: { root: { minHeight: 52, borderRadius: 14, paddingInline: 20, transition: 'box-shadow 180ms ease, border-color 180ms ease', whiteSpace: 'normal' } } },
    MuiButtonBase: { styleOverrides: { root: { '&:focus-visible, &.Mui-focusVisible': { outline: `3px solid ${palettes[mode].primary.main}`, outlineOffset: 3 } } } },
    MuiStepLabel: { styleOverrides: { label: { transition: 'none' } } },
    MuiStepIcon: { styleOverrides: { root: { transition: 'none' } } },
    MuiTextField: { defaultProps: { fullWidth: true, variant: 'outlined' } },
    MuiInputBase: { styleOverrides: { root: { fontSize: '1.125rem' } } },
    MuiFormLabel: { styleOverrides: { root: { color: palettes[mode].text.primary, transition: 'none', '&.Mui-disabled': { color: palettes[mode].text.secondary } } } },
    MuiFormHelperText: { styleOverrides: { root: { '&.Mui-disabled': { color: palettes[mode].text.secondary } } } },
    MuiInputLabel: { styleOverrides: { root: { position: 'static', transform: 'none', maxWidth: '100%', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', marginBottom: 8, lineHeight: 1.5, pointerEvents: 'auto', transition: 'none' } } },
    MuiChip: { styleOverrides: { root: { transition: 'none' } } },
    MuiFormControlLabel: { styleOverrides: { root: { minHeight: 52 } } },
    MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiRadio: { styleOverrides: { root: { padding: 12 } } },
    MuiCheckbox: { styleOverrides: { root: { padding: 12 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 14 }, notchedOutline: { '& legend': { display: 'none' } } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 20 } } },
    MuiCardContent: { styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 } } } },
    MuiAccordion: { defaultProps: { elevation: 0, disableGutters: true }, styleOverrides: { root: { background: 'transparent', '&:before': { display: 'none' } } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', minHeight: 48, fontWeight: 700 } } },
    MuiBottomNavigationAction: { styleOverrides: { root: { minHeight: 64, transition: 'none' }, label: { fontSize: '1rem', '&.Mui-selected': { fontSize: '1rem' } } } },
  },
});
