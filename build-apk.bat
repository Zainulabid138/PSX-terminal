@echo off
REM One-click Android APK build using the portable toolchain installed at F:\psx-android-tools.
REM Capacitor 8 requires JDK 21. Produces PSX-Terminal.apk in the project root.
setlocal
set "JAVA_HOME=F:\psx-android-tools\jdk21\jdk-21.0.12.1+1"
set "ANDROID_HOME=F:\psx-android-tools\sdk"
set "ANDROID_SDK_ROOT=F:\psx-android-tools\sdk"
set "ELECTRON_RUN_AS_NODE="

echo [1/4] Building web (Vite)...
call npm run build || goto :err

echo [2/4] Syncing Capacitor...
call npx cap sync android || goto :err

echo [3/4] Building APK (Gradle)...
cd android || goto :err
call .\gradlew.bat assembleDebug --no-daemon || goto :err
cd ..

echo [4/4] Copying APK to project root...
copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "PSX-Terminal.apk" >nul
echo.
echo ===============================================
echo  DONE!  APK:  %CD%\PSX-Terminal.apk
echo ===============================================
goto :eof

:err
echo.
echo BUILD FAILED. See the output above.
exit /b 1
