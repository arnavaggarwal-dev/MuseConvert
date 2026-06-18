Set objShell = CreateObject("WScript.Shell")
Dim dir : dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
objShell.CurrentDirectory = dir
objShell.Run "cmd /c npm start", 0, False
