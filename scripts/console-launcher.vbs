Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
electron = repoRoot & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  WScript.Quit 1
End If
command = """" & electron & """ """ & repoRoot & """ --hidden"
shell.Run command, 0, False
