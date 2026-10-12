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
!ifndef BUILD_UNINSTALLER
  ; Only the diagnostic block below uses this. Declaring it unconditionally trips makensis
  ; warning 6001 ("Variable not referenced") in the uninstaller build, where /WX makes it fatal.
  Var probeFile
!endif

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
      ; Diagnostic only, and deliberately run BEFORE the macro call below so that this replica of
      ; the macro's nsExec call is the cold PowerShell launch (the macro is then the warm one). It
      ; uses the macro's own /TIMEOUT=20000 and records the exit code, the raw output and the
      ; elapsed milliseconds, so the CI log can tell a cold-start timeout apart from a genuine
      ; logic difference in the macro.
      ;
      ; Written in ONE FileOpen/FileWrite/FileClose pass: NSIS "a" mode does NOT append -- it
      ; writes from offset 0 without truncating. Verified with a minimal fixture: appending
      ; "AAAA\r\n" over "1111\r\n2222\r\n3333\r\n" yields "AAAA\r\n2222\r\n3333\r\n". A second
      ; pass would therefore silently overwrite the first. Keep this file ASCII.
      System::Call 'Kernel32::SetEnvironmentVariableW(w "ZCODE_SHORTCUT_PATH", w "$newStartMenuLink") i.R4'
      System::Call 'kernel32::GetTickCount() i.R0'
      nsExec::ExecToStack /TIMEOUT=20000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "[Console]::Out.Write(([Activator]::CreateInstance([type]::GetTypeFromProgID('WScript.Shell'))).CreateShortcut([Environment]::GetEnvironmentVariable('ZCODE_SHORTCUT_PATH')).TargetPath)"`
      Pop $R1
      Pop $R2
      System::Call 'kernel32::GetTickCount() i.R3'
      IntOp $R3 $R3 - $R0
      System::Call 'Kernel32::SetEnvironmentVariableW(w "ZCODE_SHORTCUT_PATH", p 0) i.R4'

      Push "$newStartMenuLink"
      Call ZCodeReadShortcutTarget
      Pop $R8

      ; $probeFile is a named var on purpose: a register here could be clobbered between the
      ; handle being opened and the last write.
      FileOpen $probeFile "$INSTDIR\read-shortcut-target.debug.txt" w
      IfFileExists "$newStartMenuLink" zcodeProbeLnkPresent zcodeProbeLnkMissing
      zcodeProbeLnkPresent:
        FileWrite $probeFile "lnk=present$\r$\n"
        Goto zcodeProbeLnkDone
      zcodeProbeLnkMissing:
        FileWrite $probeFile "lnk=missing$\r$\n"
      zcodeProbeLnkDone:
      FileWrite $probeFile "sysdir=$SYSDIR$\r$\n"
      FileWrite $probeFile "instdir=$INSTDIR$\r$\n"
      FileWrite $probeFile "probe5.exit=$R1$\r$\n"
      FileWrite $probeFile "probe5.out=$R2$\r$\n"
      FileWrite $probeFile "probe5.ms=$R3$\r$\n"
      StrLen $R1 "$R8"
      FileWrite $probeFile "macro.result.len=$R1$\r$\n"
      FileWrite $probeFile "macro.result=$R8$\r$\n"
      FileClose $probeFile

      FileOpen $probeFile "$INSTDIR\read-shortcut-target.txt" w
      FileWrite $probeFile "$R8"
      FileClose $probeFile
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
