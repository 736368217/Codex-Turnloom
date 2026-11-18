' Windowless launcher for the Turnloom link watchdog.
'
' A scheduled task that Execs node.exe directly owns a visible console window
' (and conhost.exe) even when the task itself is marked Hidden. The working
' pattern in this repository is: Task Scheduler -> wscript.exe //B //Nologo
' -> WScript.Shell.Run(command, 0, False). The console stays hidden all the
' way down the chain, and stdout/stderr go to diagnostic logs.
Option Explicit

Dim shell, fso, comSpec, repoRoot, scriptPath, nodePath, logDir, outLog, errLog
Dim inner, command, launchLine

On Error Resume Next
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If Err.Number <> 0 Or shell Is Nothing Or fso Is Nothing Then
  WScript.Quit 1
End If
On Error Goto 0

repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
scriptPath = fso.BuildPath(repoRoot, "scripts\link-watchdog.mjs")

' Prefer the same Node installation as the other windowless launchers;
' fall back to PATH so a relocated repo still starts.
nodePath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs-24.19.0\node.exe"
If Not fso.FileExists(nodePath) Then nodePath = "node.exe"

logDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CodexPocket\logs"
EnsureFolder logDir
outLog = fso.BuildPath(logDir, "watchdog-out.log")
errLog = fso.BuildPath(logDir, "watchdog-err.log")

If Not fso.FileExists(scriptPath) Then
  AppendLog errLog, "[watchdog-launcher] missing " & scriptPath
  WScript.Quit 1
End If

comSpec = shell.ExpandEnvironmentStrings("%ComSpec%")
If Len(comSpec) = 0 Then comSpec = "cmd.exe"

' cmd /d /s /c with one outer quoted command performs the >> and 2>>
' redirections. shell.Run(..., 0, False) keeps cmd.exe, node.exe and conhost
' invisible; //B in the scheduled-task action suppresses WScript error dialogs.
inner = Q(nodePath) & " " & Q(scriptPath) & " --loop >> " & Q(outLog) & " 2>> " & Q(errLog)
command = Q(comSpec) & " /d /s /c " & Q(inner)
BumpLog outLog, 8 * 1024 * 1024
BumpLog errLog, 8 * 1024 * 1024
launchLine = Now & " [watchdog-launcher] starting hidden watchdog: " & scriptPath
AppendLog outLog, launchLine

On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
  AppendLog errLog, Now & " [watchdog-launcher] shell.Run failed: " & Err.Description
  WScript.Quit 1
End If
On Error Goto 0

WScript.Quit 0

Function Q(value)
  Q = Chr(34) & CStr(value) & Chr(34)
End Function

Sub EnsureFolder(folderPath)
  Dim parentPath
  If fso.FolderExists(folderPath) Then Exit Sub
  parentPath = fso.GetParentFolderName(folderPath)
  If Len(parentPath) > 0 Then EnsureFolder parentPath
  fso.CreateFolder folderPath
End Sub

Sub AppendLog(filePath, message)
  On Error Resume Next
  Dim stream
  Set stream = fso.OpenTextFile(filePath, 8, True)
  If Not stream Is Nothing Then
    stream.WriteLine message
    stream.Close
  End If
  On Error Goto 0
End Sub

Sub BumpLog(filePath, maxBytes)
  On Error Resume Next
  If fso.FileExists(filePath) Then
    If fso.GetFile(filePath).Size > maxBytes Then
      fso.DeleteFile filePath, True
    End If
  End If
  On Error Goto 0
End Sub
