' Starts a PowerShell script with no console window.
Option Explicit
If WScript.Arguments.Count < 1 Then WScript.Quit 1

Dim script, extra, i, shell
script = WScript.Arguments(0)
extra = ""
For i = 1 To WScript.Arguments.Count - 1
  extra = extra & " " & Q(WScript.Arguments(i))
Next

Set shell = CreateObject("Wscript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Q(script) & extra, 0, True

Function Q(value)
  Q = """" & Replace(value, """", """""") & """"
End Function
