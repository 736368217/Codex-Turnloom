' Windowless launcher for the PI-Desktop sidecar.
' A scheduled task that runs node.exe directly flashes a console window; wscript with
' Run(..., 0, False) keeps it invisible, matching the rest of the Turnloom tooling.
Option Explicit
Dim shell, fso, scriptPath, nodePath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptPath = fso.BuildPath(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)), "turnloom-pidesktop\pidesk-sidecar.mjs")
If Not fso.FileExists(scriptPath) Then
  scriptPath = "D:\pi11\11\turnloom-pidesktop\pidesk-sidecar.mjs"
End If

nodePath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs-24.19.0\node.exe"
If Not fso.FileExists(nodePath) Then
  nodePath = "node.exe"
End If

command = """" & nodePath & """ """ & scriptPath & """"
shell.CurrentDirectory = fso.GetParentFolderName(scriptPath)
shell.Run command, 0, False
