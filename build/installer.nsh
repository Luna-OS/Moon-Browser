; Registers Moon Browser as a web browser, so it shows up in Windows'
; Settings → Apps → Default apps and can open http(s) links and .html files.
;
; The command lines end with -- "%1": everything after "--" is treated as
; an address, never as a command-line switch (no switch injection from links).

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
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Moon Browser"
  DeleteRegKey SHCTX "${MOON_CLIENT}"
  DeleteRegKey SHCTX "Software\Classes\MoonBrowserURL"
  DeleteRegKey SHCTX "Software\Classes\MoonBrowserHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
