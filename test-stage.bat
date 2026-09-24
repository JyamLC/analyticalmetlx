@echo off
REM ============================================================
REM  Team Chat v1 - promote to the TEST stage and run it
REM  1) checks you are on the "test" branch
REM  2) runs the automated tests (JavaScript + Scala)
REM  3) starts MeTL against a separate H2 TEST database
REM ============================================================
setlocal

for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
if not "%BRANCH%"=="test" (
  echo You are on branch "%BRANCH%". Switch first:  git checkout test
  exit /b 1
)

echo.
echo === Step 1: JavaScript unit tests ===
node src\test\js\teamChat\teamChatRules.test.js
if errorlevel 1 ( echo JavaScript tests FAILED - not promoting. & exit /b 1 )

echo.
echo === Step 2: Scala unit tests ===
call sbt.bat "testOnly com.metl.utils.ChatRulesSuite"
if errorlevel 1 ( echo Scala tests FAILED - not promoting. & exit /b 1 )

echo.
echo === Step 3: Test configuration (separate H2 database) ===
if not exist config\configuration.test.xml (
  if not exist config\configuration.local.xml ( echo config\configuration.local.xml not found & exit /b 1 )
  powershell -NoProfile -Command "(Get-Content config\configuration.local.xml) -replace 'testdb\.h2','metl-test.h2' | Set-Content config\configuration.test.xml"
  echo Created config\configuration.test.xml ^(database: metl-test.h2^)
)

echo.
echo === Step 4: Starting MeTL (TEST stage) - open http://localhost:8080 ===
java -Xmx1024M -Dsbt.boot.directory="%IVY_HOME%\.sbt-boot" -Dsbt.global.home="%IVY_HOME%\.sbt" -Dsbt.home="%IVY_HOME%\.sbt" -Dsbt.ivy.home=%IVY_HOME%\.ivy2\ -Dsbt.global.staging="%IVY_HOME%\.sbt-staging" -Dmetlx.configurationFile="./config/configuration.test.xml" -Dlogback.configurationFile="config/logback.xml" -Dorg.eclipse.jetty.server.Request.maxFormContentSize=300000000 -Dstackable.spending=enabled -jar sbt-launch.jar container:start shell
endlocal
