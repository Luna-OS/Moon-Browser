; Moon Browser's Windows installer: the night-sky theme of MoonTask's
; installer, adapted to electron-builder's NSIS templates, plus the
; registration as a web browser.
;
; electron-builder includes this file before its installer.nsi (see
; electron-builder.yml: nsis > include) and calls the custom* macros below
; at fixed places. The page macros hook the theme into each page:
;
;   customWelcomePage          welcome page (full) + arms the directory page
;   customPageAfterChangeDir   arms the install page
;   customFinishPage           finish page (full)
;   customUnWelcomePage        uninstaller welcome + arms its install page
;   customUninstallPage        arms the uninstaller's finish page
;
; NSIS draws with plain Win32 controls, so the theme works per control:
; SetCtlColors for backgrounds and text, the "DarkMode_Explorer" visual style
; for push buttons and scroll bars, and no visual style at all for check
; boxes, radio buttons, group boxes and the progress bar — with a visual
; style Windows ignores their text and bar colors.
;
; makensis runs with warnings as errors, so every function exists only in
; the pass that uses it (BUILD_UNINSTALLER is the uninstaller's pass).

!include LogicLib.nsh
!include WinMessages.nsh

; The palette of src/renderer/theme/tokens.css.
!define MB_NIGHT_950 "0B0920"
!define MB_NIGHT_900 "141030"
!define MB_NIGHT_800 "1D1742"
!define MB_MOON_100 "F4F1FF"
!define MB_LAVENDER_300 "D6CFFD"
!define MB_LAVENDER_400 "B9AEFB"
!define MB_FAINT "8C84B8"
!define MB_LINE "2E2660"
; The same colors as COLORREF (0x00BBGGRR) for the Win32 calls below.
!define MB_NIGHT_950_REF 0x0020090B
!define MB_NIGHT_900_REF 0x00301014
!define MB_LAVENDER_400_REF 0x00FBAEB9
!define MB_VIOLET_700_REF 0x006B2E3B

; The header strip and the welcome and finish pages.
!define MUI_BGCOLOR "${MB_NIGHT_800}"
!define MUI_TEXTCOLOR "${MB_MOON_100}"
; The log on the installation page.
!define MUI_INSTFILESPAGE_COLORS "${MB_LAVENDER_300} ${MB_NIGHT_950}"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth colored"
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.MoonThemeWindow
  !define MB_UN "un."
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT MoonThemeWindow
  !define MB_UN ""
!endif

; Win32 constants, prefixed: MUI and nsDialogs define some of them later.
!define MB_GWL_STYLE -16
!define MB_GWL_EXSTYLE -20
; SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
!define MB_SWP_REFRAME 0x37
!define MB_BS_TYPEMASK 0x0F
!define MB_BS_GROUPBOX 0x07
!define MB_BS_DEFPUSHBUTTON 0x01
!define MB_BS_FLAT 0x8000
!define MB_SS_TYPEMASK 0x1F
!define MB_SS_ICON 0x03
!define MB_SS_BITMAP 0x0E
!define MB_SS_ETCHEDHORZ 0x10
!define MB_SS_ETCHEDFRAME 0x12
!define MB_PBM_SETBARCOLOR 0x0409
!define MB_PBM_SETBKCOLOR 0x2001
!define MB_STM_SETIMAGE 0x0172
!define MB_IMAGE_BITMAP 0
!define MB_LR_LOADFROMFILE 0x0010

; Sharp images on high-DPI screens. MUI stretches the 100 % bitmaps to the
; size of their controls, which blurs them at 125 % and above; these are the
; same images rendered at larger scales, and the closest one replaces MUI's.
!macro MOON_EXTRACT_IMAGES NAME
  File "/oname=$PLUGINSDIR\moon-${NAME}-125.bmp" "${__FILEDIR__}/hidpi/${NAME}-125.bmp"
  File "/oname=$PLUGINSDIR\moon-${NAME}-150.bmp" "${__FILEDIR__}/hidpi/${NAME}-150.bmp"
  File "/oname=$PLUGINSDIR\moon-${NAME}-200.bmp" "${__FILEDIR__}/hidpi/${NAME}-200.bmp"
  File "/oname=$PLUGINSDIR\moon-${NAME}-250.bmp" "${__FILEDIR__}/hidpi/${NAME}-250.bmp"
!macroend

!macro _MOON_PICK_SCALE WIDTH SCALE
  ${If} $R5 == ""
  ${AndIf} $R3 <= ${WIDTH}
    StrCpy $R5 ${SCALE}
  ${EndIf}
!macroend

; Stack: the image control, then "header" or "sidebar" on top.
Function ${MB_UN}MoonSharpImage
  Exch $R0
  Exch
  Exch $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  System::Call "*(i, i, i, i) p .R2"
  System::Call "user32::GetClientRect(p R1, p R2)"
  System::Call "*$R2(i, i, i .R3, i .R4)"
  System::Free $R2
  StrCpy $R5 ""
  ${If} $R0 == "header"
    ${If} $R3 > 150
      !insertmacro _MOON_PICK_SCALE 188 125
      !insertmacro _MOON_PICK_SCALE 225 150
      !insertmacro _MOON_PICK_SCALE 300 200
      ${IfThen} $R5 == "" ${|} StrCpy $R5 250 ${|}
    ${EndIf}
  ${ElseIf} $R3 > 164
    !insertmacro _MOON_PICK_SCALE 205 125
    !insertmacro _MOON_PICK_SCALE 246 150
    !insertmacro _MOON_PICK_SCALE 328 200
    ${IfThen} $R5 == "" ${|} StrCpy $R5 250 ${|}
  ${EndIf}
  ${If} $R5 != ""
    System::Call "user32::LoadImageW(p 0, w '$PLUGINSDIR\moon-$R0-$R5.bmp', i ${MB_IMAGE_BITMAP}, i R3, i R4, i ${MB_LR_LOADFROMFILE}) p .R2"
    ; MUI frees the image it set when the page closes; this one lives
    ; until Setup exits.
    ${If} $R2 P<> 0
      SendMessage $R1 ${MB_STM_SETIMAGE} ${MB_IMAGE_BITMAP} $R2
    ${EndIf}
  ${EndIf}
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; A page: its dialog and every control on it, on the background BG.
; (SetCtlColors takes its colors at compile time, hence one function per
; background.)
!macro MOON_THEME_PAGE_FUNCTION NAME BG
  Function ${MB_UN}${NAME}
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    ; Every dialog in the window: which one holds the new page differs
    ; between inner and full-window pages, and theming a stale one is harmless.
    StrCpy $0 0
    ${Do}
      FindWindow $0 "#32770" "" $HWNDPARENT $0
      ${If} $0 = 0
        ${Break}
      ${EndIf}
      SetCtlColors $0 "" "${BG}"
      StrCpy $1 0
      ${Do}
        FindWindow $1 "" "" $0 $1
        ${If} $1 = 0
          ${Break}
        ${EndIf}
        System::Call "user32::GetClassNameW(p r1, w .r2, i 64)"
        System::Call "user32::GetWindowLongW(p r1, i ${MB_GWL_STYLE}) i .r3"
        ${If} $2 == "Static"
          IntOp $4 $3 & ${MB_SS_TYPEMASK}
          ${If} $4 = ${MB_SS_BITMAP}
            Push $1
            Push "sidebar"
            Call ${MB_UN}MoonSharpImage
          ${ElseIf} $4 <> ${MB_SS_ICON}
          ${AndIf} $4 < ${MB_SS_ETCHEDHORZ}
            SetCtlColors $1 "${MB_MOON_100}" "${BG}"
          ${EndIf}
        ${ElseIf} $2 == "Button"
          IntOp $4 $3 & ${MB_BS_TYPEMASK}
          ${If} $4 <= ${MB_BS_DEFPUSHBUTTON}
            System::Call "uxtheme::SetWindowTheme(p r1, w 'DarkMode_Explorer', p 0)"
          ${Else}
            ; Check boxes, radio buttons and group boxes: unstyled, so that
            ; Windows draws their text in our color.
            System::Call "uxtheme::SetWindowTheme(p r1, w '', w '')"
            ${If} $4 = ${MB_BS_GROUPBOX}
              SetCtlColors $1 "${MB_LAVENDER_300}" "${BG}"
            ${Else}
              IntOp $3 $3 | ${MB_BS_FLAT}
              System::Call "user32::SetWindowLongW(p r1, i ${MB_GWL_STYLE}, i r3)"
              SetCtlColors $1 "${MB_MOON_100}" "${BG}"
            ${EndIf}
          ${EndIf}
        ${ElseIf} $2 == "Edit"
          SetCtlColors $1 "${MB_MOON_100}" "${MB_NIGHT_950}"
        ${ElseIf} $2 == "msctls_progress32"
          System::Call "uxtheme::SetWindowTheme(p r1, w '', w '')"
          SendMessage $1 ${MB_PBM_SETBARCOLOR} 0 ${MB_LAVENDER_400_REF}
          SendMessage $1 ${MB_PBM_SETBKCOLOR} 0 ${MB_NIGHT_950_REF}
        ${ElseIf} $2 == "SysListView32"
          System::Call "uxtheme::SetWindowTheme(p r1, w 'DarkMode_Explorer', p 0)"
        ${EndIf}
      ${Loop}
    ${Loop}
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend

; Pages inside the header strip, and the welcome and finish pages that
; cover it.
!insertmacro MOON_THEME_PAGE_FUNCTION MoonThemeInnerPage "${MB_NIGHT_900}"
!insertmacro MOON_THEME_PAGE_FUNCTION MoonThemeFullPage "${MUI_BGCOLOR}"

; The outer window: title bar, frame, header and the Back / Next / Cancel row.
Function ${MB_UN}MoonThemeWindow
  Push $0
  Push $1
  Push $2
  ; A dark title bar (Windows 10 20H1+), tinted night on Windows 11.
  ; Older Windows ignores the unknown attributes.
  System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)"
  System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i ${MB_NIGHT_900_REF}, i 4)"
  System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i ${MB_VIOLET_700_REF}, i 4)"

  SetCtlColors $HWNDPARENT "" "${MB_NIGHT_900}"
  InitPluginsDir
  !insertmacro MOON_EXTRACT_IMAGES header
  !insertmacro MOON_EXTRACT_IMAGES sidebar
  GetDlgItem $0 $HWNDPARENT 1046
  Push $0
  Push "header"
  Call ${MB_UN}MoonSharpImage
  ; The header's subtitle, a little softer than its title.
  GetDlgItem $0 $HWNDPARENT 1038
  SetCtlColors $0 "${MB_LAVENDER_300}" "${MUI_BGCOLOR}"
  ; The branding line above the buttons.
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 "${MB_FAINT}" "${MB_NIGHT_900}"
  GetDlgItem $0 $HWNDPARENT 1256
  SetCtlColors $0 "${MB_FAINT}" "${MB_NIGHT_900}"
  ${ForEach} $1 1 3 + 1
    GetDlgItem $0 $HWNDPARENT $1
    System::Call "uxtheme::SetWindowTheme(p r0, w 'DarkMode_Explorer', p 0)"
  ${Next}
  ; The etched lines under the header and above the buttons are drawn in
  ; system colors, bright white on night. Turn them into plain statics,
  ; which fill themselves with a quiet line color instead.
  StrCpy $0 0
  ${Do}
    FindWindow $0 "Static" "" $HWNDPARENT $0
    ${If} $0 = 0
      ${Break}
    ${EndIf}
    System::Call "user32::GetWindowLongW(p r0, i ${MB_GWL_STYLE}) i .r1"
    IntOp $2 $1 & ${MB_SS_TYPEMASK}
    ${If} $2 >= ${MB_SS_ETCHEDHORZ}
    ${AndIf} $2 <= ${MB_SS_ETCHEDFRAME}
      IntOp $1 $1 & -32 ; clears SS_TYPEMASK
      System::Call "user32::SetWindowLongW(p r0, i ${MB_GWL_STYLE}, i r1)"
      System::Call "user32::GetWindowLongW(p r0, i ${MB_GWL_EXSTYLE}) i .r1"
      IntOp $1 $1 & -131073 ; clears WS_EX_STATICEDGE
      System::Call "user32::SetWindowLongW(p r0, i ${MB_GWL_EXSTYLE}, i r1)"
      System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i ${MB_SWP_REFRAME})"
      SetCtlColors $0 "" "${MB_LINE}"
    ${EndIf}
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; ---- Pages ----

!macro customWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoonThemeFullPage
  !define MUI_WELCOMEPAGE_TITLE "$(moonWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(moonWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
  ; The folder page gets no show hook of its own here (the skipped install
  ; mode page before it takes the one it is offered). NSIS calls this when
  ; the folder page checks its path — as it appears, and on every change —
  ; so the page is themed right when it shows.
  Function .onVerifyInstDir
    Call MoonThemeInnerPage
  FunctionEnd
!endif

; Between the folder page and the install page.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoonThemeInnerPage
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoonThemeFullPage
  !define MUI_FINISHPAGE_TEXT_LARGE
  !define MUI_FINISHPAGE_TITLE "$(moonFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(moonFinishText)"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.MoonThemeFullPage
  !define MUI_WELCOMEPAGE_TEXT "$(moonUnWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
  ; For the uninstall page that follows (the install mode page is skipped).
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.MoonThemeInnerPage
!macroend

; Between the uninstall page and the uninstaller's finish page.
!macro customUninstallPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.MoonThemeFullPage
!macroend

; Always for the current user only: no administrator rights, and updates
; install without a UAC prompt.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ---- Texts (after the languages are loaded) ----

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    LangString moonWelcomeTitle ${LANG_ENGLISH} "Welcome to Moon Browser"
    LangString moonWelcomeText ${LANG_ENGLISH} "The web, calmly under the moon.$\r$\n$\r$\nMoon Browser is a private browser: ads and trackers are blocked, sites load over HTTPS first, and nothing is sent anywhere behind your back.$\r$\n$\r$\nIt is installed for your user account only and needs no administrator rights. Your bookmarks, history and settings stay when you install an update.$\r$\n$\r$\nClick Next to continue."
    LangString moonFinishTitle ${LANG_ENGLISH} "Moon Browser is ready"
    LangString moonFinishText ${LANG_ENGLISH} "Moon Browser has been installed and is waiting in the Start menu. Updates install over it by themselves; there is never a need to uninstall first.$\r$\n$\r$\nTip: in Settings, under Import, you can bring over your bookmarks and history from Comet, Chrome, Edge or Brave."
    LangString moonWelcomeTitle ${LANG_GERMAN} "Willkommen bei Moon Browser"
    LangString moonWelcomeText ${LANG_GERMAN} "Das Web, ruhig unter dem Mond.$\r$\n$\r$\nMoon Browser ist ein privater Browser: Werbung und Tracker werden blockiert, Seiten laden zuerst über HTTPS, und nichts wird heimlich irgendwohin gesendet.$\r$\n$\r$\nEr wird nur für Ihr Benutzerkonto installiert und braucht keine Administratorrechte. Lesezeichen, Verlauf und Einstellungen bleiben bei jedem Update erhalten.$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."
    LangString moonFinishTitle ${LANG_GERMAN} "Moon Browser ist bereit"
    LangString moonFinishText ${LANG_GERMAN} "Moon Browser wurde installiert und wartet im Startmenü. Updates installieren sich von selbst darüber; Sie müssen nie vorher deinstallieren.$\r$\n$\r$\nTipp: In den Einstellungen unter „Import“ holen Sie Lesezeichen und Verlauf aus Comet, Chrome, Edge oder Brave herüber."
  !else
    LangString moonUnWelcomeText ${LANG_ENGLISH} "This removes Moon Browser from your computer.$\r$\n$\r$\nYour profile — bookmarks, history and settings — stays in your user folder, so a later installation can pick it up again.$\r$\n$\r$\nClick Next to continue."
    LangString moonUnWelcomeText ${LANG_GERMAN} "Hiermit wird Moon Browser von Ihrem Computer entfernt.$\r$\n$\r$\nIhr Profil — Lesezeichen, Verlauf und Einstellungen — bleibt in Ihrem Benutzerordner, sodass eine spätere Installation es wieder aufgreifen kann.$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."
  !endif
!macroend

; ---- Registration as a web browser ----
;
; Moon Browser shows up in Windows' Settings → Apps → Default apps and can
; open http(s) links and .html files. The command lines end with -- "%1":
; everything after "--" is treated as an address, never as a command-line
; switch (no switch injection from links).

!define MOON_CLIENT "Software\Clients\StartMenuInternet\Moon Browser"
!define MOON_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!macro customInstall
  WriteRegStr SHCTX "Software\RegisteredApplications" "Moon Browser" "${MOON_CLIENT}\Capabilities"

  WriteRegStr SHCTX "${MOON_CLIENT}" "" "Moon Browser"
  WriteRegStr SHCTX "${MOON_CLIENT}\DefaultIcon" "" "${MOON_EXE},0"
  WriteRegStr SHCTX "${MOON_CLIENT}\shell\open\command" "" '"${MOON_EXE}"'
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities" "ApplicationName" "Moon Browser"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities" "ApplicationDescription" "The web, calmly under the moon."
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities" "ApplicationIcon" "${MOON_EXE},0"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "Moon Browser"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities\URLAssociations" "http" "MoonBrowserURL"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities\URLAssociations" "https" "MoonBrowserURL"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities\FileAssociations" ".htm" "MoonBrowserHTML"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities\FileAssociations" ".html" "MoonBrowserHTML"
  WriteRegStr SHCTX "${MOON_CLIENT}\Capabilities\FileAssociations" ".xhtml" "MoonBrowserHTML"

  WriteRegStr SHCTX "Software\Classes\MoonBrowserURL" "" "Moon Browser URL"
  WriteRegStr SHCTX "Software\Classes\MoonBrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\MoonBrowserURL\DefaultIcon" "" "${MOON_EXE},0"
  WriteRegStr SHCTX "Software\Classes\MoonBrowserURL\shell\open\command" "" '"${MOON_EXE}" -- "%1"'

  WriteRegStr SHCTX "Software\Classes\MoonBrowserHTML" "" "Moon Browser HTML Document"
  WriteRegStr SHCTX "Software\Classes\MoonBrowserHTML\DefaultIcon" "" "${MOON_EXE},0"
  WriteRegStr SHCTX "Software\Classes\MoonBrowserHTML\shell\open\command" "" '"${MOON_EXE}" -- "%1"'

  ; Tell Explorer that file associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; An update removes the old version first; the registration stays.
  ${ifNot} ${isUpdated}
    DeleteRegValue SHCTX "Software\RegisteredApplications" "Moon Browser"
    DeleteRegKey SHCTX "${MOON_CLIENT}"
    DeleteRegKey SHCTX "Software\Classes\MoonBrowserURL"
    DeleteRegKey SHCTX "Software\Classes\MoonBrowserHTML"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${endIf}
!macroend
