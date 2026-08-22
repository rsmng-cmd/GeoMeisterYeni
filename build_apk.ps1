$env:JAVA_HOME = "C:\Users\rsmng\OneDrive\MASAST~1\JDK-21~1.10_"
$env:ANDROID_HOME = "C:\Users\rsmng\AppData\Local\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Set-Location "C:\Users\rsmng\OneDrive\MASAST~1\AGUSTO~1\android"
.\gradlew.bat assembleDebug
