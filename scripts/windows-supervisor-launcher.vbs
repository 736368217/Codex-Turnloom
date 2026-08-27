Option Explicit

If WScript.Arguments.Count <> 3 Then
  WScript.Quit 64
End If

Dim shell, command, exitCode
Set shell = CreateObject("WScript.Shell")

command = QuoteArgument(WScript.Arguments(0)) _
  & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " _
  & QuoteArgument(WScript.Arguments(1)) _
  & " -ConfigPath " & QuoteArgument(WScript.Arguments(2))

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & CStr(value) & Chr(34)
End Function
