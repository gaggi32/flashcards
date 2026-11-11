; Included by Tauri's NSIS installer, ahead of its own pages.
;
; The installer finds an existing install through Software\<publisher>\<product>.
; Versions up to 0.1.6 were published under another name, so before the first
; page (where an older version gets uninstalled) copy their key over to ours.
; Without it, installing over one of them runs its uninstaller without a
; folder and stops with "unable to uninstall".
; Spelled out: this file is read before the installer defines its own names.
!define OLD_MANUPRODUCTKEY "Software\404canvas\Flashcards"
!define NEW_MANUPRODUCTKEY "Software\gaggi32\Flashcards"
!define MUI_CUSTOMFUNCTION_GUIINIT AdoptOldInstallKey

Function AdoptOldInstallKey
  Push $0
  ReadRegStr $0 SHCTX "${NEW_MANUPRODUCTKEY}" ""
  ${If} $0 == ""
    ReadRegStr $0 SHCTX "${OLD_MANUPRODUCTKEY}" ""
    ${If} $0 != ""
      WriteRegStr SHCTX "${NEW_MANUPRODUCTKEY}" "" $0
    ${EndIf}
  ${EndIf}
  Pop $0
FunctionEnd

; Once this version is in, the old key has done its job.
!macro NSIS_HOOK_POSTINSTALL
  DeleteRegKey SHCTX "${OLD_MANUPRODUCTKEY}"
  DeleteRegKey /ifempty SHCTX "Software\404canvas"
!macroend
