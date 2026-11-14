Option Explicit
Dim shell, fso, base, runner
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
runner = fso.BuildPath(base, "pidesk-sidecar-runner.ps1")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & runner & """", 0, False
