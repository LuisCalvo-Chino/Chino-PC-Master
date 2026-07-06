@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM Cuenta GitHub correcta para este repositorio (push a LuisCalvo-Chino/Chino-PC-Master)
set "GITHUB_USER=LuisCalvo-Chino"
set "REPO_URL=https://%GITHUB_USER%@github.com/LuisCalvo-Chino/Chino-PC-Master.git"
set "GIT_CMD=git"
set "CLEAR_CREDS=0"
set "COMMIT_MSG="

if /i "%~1"=="cambiar-cuenta" set "CLEAR_CREDS=1"
if /i "%~1"=="--cambiar-cuenta" set "CLEAR_CREDS=1"
if defined CPM_GIT_CAMBIAR_CUENTA set "CLEAR_CREDS=1"

if /i not "%~1"=="cambiar-cuenta" if /i not "%~1"=="--cambiar-cuenta" if not "%~1"=="" set "COMMIT_MSG=%~1"

where "%GIT_CMD%" >nul 2>&1
if errorlevel 1 (
    if exist "%ProgramFiles%\Git\bin\git.exe" (
        set "GIT_CMD=%ProgramFiles%\Git\bin\git.exe"
    ) else if exist "%ProgramFiles%\Git\cmd\git.exe" (
        set "GIT_CMD=%ProgramFiles%\Git\cmd\git.exe"
    ) else if exist "%ProgramW6432%\Git\bin\git.exe" (
        set "GIT_CMD=%ProgramW6432%\Git\bin\git.exe"
    ) else (
        echo No se encontro "git" en el PATH ni en rutas comunes.
        echo Instala Git para Windows o agrega git.exe al PATH.
        exit /b 1
    )
)

if not exist ".git\" (
    echo No hay carpeta .git en: %cd%
    echo Ejecuta "git init" y vincula el remoto, o clona el repositorio aqui.
    exit /b 1
)

echo === Repositorio: %cd% ===
echo === Git: %GIT_CMD% ===
echo === Cuenta GitHub: %GITHUB_USER% ===
echo === Remoto origin: %REPO_URL% ===
echo.

if "%CLEAR_CREDS%"=="1" (
    echo Borrando credenciales guardadas de GitHub en este equipo...
    echo ^(La proxima vez que hagas push pedira iniciar sesion como %GITHUB_USER%^)
    echo.
    cmdkey /delete:LegacyGeneric:target=git:https://github.com >nul 2>&1
    echo protocol=https> "%TEMP%\cpm_git_cred_reject.txt"
    echo host=github.com>> "%TEMP%\cpm_git_cred_reject.txt"
    echo.>> "%TEMP%\cpm_git_cred_reject.txt"
    "%GIT_CMD%" credential reject < "%TEMP%\cpm_git_cred_reject.txt" >nul 2>&1
    del "%TEMP%\cpm_git_cred_reject.txt" >nul 2>&1
    echo Credenciales de GitHub eliminadas.
    echo.
)

"%GIT_CMD%" remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo Anadiendo remoto "origin"...
    "%GIT_CMD%" remote add origin "%REPO_URL%"
    if errorlevel 1 (
        echo No se pudo anadir el remoto origin.
        exit /b 1
    )
) else (
    echo Ajustando URL de "origin" ^(cuenta %GITHUB_USER%^)...
    "%GIT_CMD%" remote set-url origin "%REPO_URL%"
    if errorlevel 1 (
        echo No se pudo actualizar la URL del remoto origin.
        exit /b 1
    )
)

REM Autor de commits solo en este repo (cuenta LuisCalvo-Chino)
if defined CPM_GIT_USER_EMAIL (
    "%GIT_CMD%" config user.email "%CPM_GIT_USER_EMAIL%"
) else (
    "%GIT_CMD%" config user.email "LuisCalvo-Chino@users.noreply.github.com"
)
if defined CPM_GIT_USER_NAME (
    "%GIT_CMD%" config user.name "%CPM_GIT_USER_NAME%"
) else (
    "%GIT_CMD%" config user.name "Luis Calvo"
)

for /f "tokens=* usebackq" %%B in (`"%GIT_CMD%" rev-parse --abbrev-ref HEAD 2^>nul`) do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH (
    echo No se pudo detectar la rama actual.
    exit /b 1
)
echo Rama actual: %CURRENT_BRANCH%
echo.

"%GIT_CMD%" add -A
"%GIT_CMD%" diff --cached --quiet
if errorlevel 1 (
    if not defined COMMIT_MSG (
        set "COMMIT_MSG=chore: sincronizar cambios locales"
    )
    "%GIT_CMD%" commit -m "!COMMIT_MSG!"
    if errorlevel 1 (
        echo El commit fallo. Revisa el mensaje de arriba.
        exit /b 1
    )
    echo Cambios confirmados.
) else (
    echo No hay cambios nuevos que confirmar.
)

echo.
echo Enviando a origin como %GITHUB_USER% ^(%CURRENT_BRANCH%^)...
"%GIT_CMD%" push -u origin "%CURRENT_BRANCH%"
if errorlevel 1 (
    echo.
    echo Push fallido.
    echo Si aparece "Permission denied" o la cuenta equivocada, ejecuta:
    echo   GitHub Push.bat cambiar-cuenta
    echo y vuelve a iniciar sesion con la cuenta %GITHUB_USER%.
    exit /b 1
)

echo.
echo Listo: push a GitHub completado con la cuenta %GITHUB_USER%.
exit /b 0
