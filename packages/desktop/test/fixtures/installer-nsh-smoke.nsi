Unicode true
Name "ZCode installer.nsh smoke"
OutFile "${OUTPUT_FILE}"
InstallDir "$TEMP\zcode-installer-nsh-smoke"
RequestExecutionLevel user
SilentInstall silent

!addincludedir "${NSIS_INCLUDE_DIR}"
!addincludedir "${ELECTRON_BUILDER_NSIS_INCLUDE_DIR}"

!include "LogicLib.nsh"
!ifndef BUILD_UNINSTALLER
  !include "MUI2.nsh"
  !include "StrContains.nsh"
!endif

!define APP_DESCRIPTION "ZCode NSIS smoke fixture"
!define APP_FILENAME "ZCode"
!define APP_ID "dev.zcode.installer-nsh-smoke"
!define UNINSTALL_FILENAME "uninstaller.exe"
; This fixture invokes the cleanup macro from a normal section; electron-builder's real uninstaller uses un.*.
!ifdef BUILD_UNINSTALLER
  !define ZCODE_UNINSTALLER_FUNCTION_PREFIX ""
!endif
; Simulate a manually launched overwrite installer without --updated.
!define isUpdated `1 == 0`
!define allowToChangeInstallationDirectory
!define ZCODE_INSTALLER_DEFAULT_LOG_PATH "${DEFAULT_LOG_PATH}"
!define ZCODE_INSTALLER_ELEVATED_LOG_PATH "${ELEVATED_LOG_PATH}"
!ifdef FORCE_ELEVATED_INNER
  !define ZCODE_INSTALLER_IS_ELEVATED_INNER `1 == 1`
!endif

Var appExe
Var launchLink
Var newStartMenuLink
Var newDesktopLink
Var keepShortcuts

!include "${ZCODE_INSTALLER_NSH}"
; Keep this file ASCII, or give it a UTF-8 BOM. makensis decodes a BOM-less script with the system
; ANSI code page, so UTF-8 Chinese whose bytes are not a valid sequence there aborts the compile with
; "Bad text encoding" -- it is byte-sequence dependent, not a blanket "Chinese fails".
; Regression: electron-builder may register the plugin dir after this include.
; Use the real UAC check so a constant-false stand-in cannot hide a missing plugin.
!addplugindir /x86-unicode "${NSIS_PLUGIN_DIR}"
!ifndef BUILD_UNINSTALLER
  ; electron-builder inserts customHeader after assistedInstaller.nsh generated the directory page.
  !insertmacro customHeader
  !ifdef allowToChangeInstallationDirectory
    !error "customHeader must enable shortcut preservation for manual overwrite"
  !endif
  !insertmacro customPageAfterChangeDir

  Function .onInit
    !insertmacro preInit
  FunctionEnd
!endif

Section
  SetOutPath "$INSTDIR"
  File /oname=ZCode.exe "${FIXTURE_EXE}"
  StrCpy $appExe "$INSTDIR\ZCode.exe"
  StrCpy $launchLink "$INSTDIR\stale-target.exe"
  StrCpy $newStartMenuLink "$INSTDIR\start-menu.lnk"
  StrCpy $newDesktopLink "$INSTDIR\desktop.lnk"
  StrCpy $keepShortcuts "true"

  !ifdef PRECREATE_SHORTCUTS
    !ifdef STALE_SHORTCUTS
      CreateShortCut "$newStartMenuLink" "$INSTDIR\stale-target.exe" "--stale"
      CreateShortCut "$newDesktopLink" "$INSTDIR\stale-target.exe" "--stale"
    !else
      CreateShortCut "$newStartMenuLink" "$appExe" "--preserved"
      CreateShortCut "$newDesktopLink" "$appExe" "--preserved"
    !endif

    !ifndef BUILD_UNINSTALLER
      Push "$newStartMenuLink"
      Call ZCodeReadShortcutTarget
      Pop $R8
      FileOpen $0 "$INSTDIR\read-shortcut-target.txt" w
      FileWrite $0 "$R8"
      FileClose $0

      ; Diagnostic only. When the read above yields nothing, an empty result is
      ; indistinguishable from "the shortcut was never created", and this fixture only runs
      ; on Windows. Dump the preconditions -- does the .lnk exist, and what did PowerShell
      ; actually return -- so the smoke test can put the root cause in its own error message.
      ; Keep this file ASCII (see the encoding note above).
      FileOpen $0 "$INSTDIR\read-shortcut-target.debug.txt" w
      ${If} ${FileExists} "$newStartMenuLink"
        FileWrite $0 "lnk=present$\r$\n"
      ${Else}
        FileWrite $0 "lnk=missing$\r$\n"
      ${EndIf}
      StrLen $R1 "$R8"
      FileWrite $0 "macro.result.len=$R1$\r$\n"
      System::Call 'Kernel32::SetEnvironmentVariableW(w "ZCODE_SHORTCUT_PATH", w "$newStartMenuLink") i.R1'
      nsExec::ExecToStack /TIMEOUT=10000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "[Console]::Out.Write(([Activator]::CreateInstance([type]::GetTypeFromProgID('WScript.Shell'))).CreateShortcut([Environment]::GetEnvironmentVariable('ZCODE_SHORTCUT_PATH')).TargetPath)"`
      Pop $R1
      Pop $R2
      FileWrite $0 "ps.exit=$R1$\r$\n"
      FileWrite $0 "ps.out=$R2$\r$\n"
      System::Call 'Kernel32::SetEnvironmentVariableW(w "ZCODE_SHORTCUT_PATH", p 0) i.R1'
      FileWrite $0 "sysdir=$SYSDIR$\r$\n"
      FileWrite $0 "instdir=$INSTDIR$\r$\n"
      FileClose $0
    !endif
  !endif

  !ifndef BUILD_UNINSTALLER
    SetDetailsPrint none
    !insertmacro customInit
    ; The real electron-builder template invokes these hooks at the same points.
    !insertmacro customInstallSectionStarted
    !insertmacro customInstallCleanupStarted
    !insertmacro customInstallCleanupCompleted
    !insertmacro customInstallExtractStarted
    !insertmacro customInstallExtractCompleted
    !insertmacro customInstallShortcutsStarted
    !insertmacro customInstallShortcutsCompleted
    !insertmacro customInstall
  !endif

  FileOpen $0 "$INSTDIR\launch-link.txt" w
  FileWrite $0 "$launchLink"
  FileClose $0

  ; Expand cleanup diagnostics in the uninstaller smoke fixture so /WX checks the reference.
  !ifdef BUILD_UNINSTALLER
    !insertmacro customRemoveFiles
  !endif

SectionEnd
