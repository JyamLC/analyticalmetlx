#!/usr/bin/env bash
# Team Chat - promote to the TEST stage and run it (Mac/Linux version of test-stage.bat)
set -e
# MeTL only runs on Java 8 (DEF-04). Use the SDKMAN Java 8 install if it is there.
J8=$(ls -d "$HOME"/.sdkman/candidates/java/8* 2>/dev/null | head -1)
if [ -n "$J8" ]; then export JAVA_HOME="$J8"; export PATH="$JAVA_HOME/bin:$PATH"; fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "test" ]; then echo "You are on '$BRANCH'. Switch first: git checkout test"; exit 1; fi
echo "=== Step 1: JavaScript unit tests ==="
if command -v node >/dev/null 2>&1; then
  node src/test/js/teamChat/teamChatRules.test.js
else
  echo "Node.js is not installed - skipping JavaScript tests (install from https://nodejs.org to run them)."
fi
echo "=== Step 2: Scala unit tests ===";      ./sbt.sh "testOnly com.metl.utils.ChatRulesSuite"
echo "=== Step 3: Test configuration (separate H2 database) ==="
if [ ! -f config/configuration.test.xml ]; then
  [ -f config/configuration.local.xml ] || { echo "config/configuration.local.xml not found"; exit 1; }
  sed 's/testdb\.h2/metl-test.h2/' config/configuration.local.xml > config/configuration.test.xml
  echo "Created config/configuration.test.xml (database: metl-test.h2)"
fi
# DEF-06: mark people Offline about 45 seconds after they close the board (MeTL default is 2 minutes)
if ! grep -q "metlActorLifespan" config/configuration.test.xml; then
  sed -i.bak 's#</serverConfiguration>#<cometConfiguration><metlActorLifespan>45 seconds</metlActorLifespan></cometConfiguration></serverConfiguration>#' config/configuration.test.xml && rm -f config/configuration.test.xml.bak
  echo "Test config: people are marked Offline about 45 seconds after leaving"
fi
echo "=== Step 4: Starting MeTL (TEST stage) on port 8081 - open http://localhost:8081 when you see [success] ==="
sed "s|configuration.local.xml|configuration.test.xml|" sbt.sh > ./.sbt-test.sh && chmod +x ./.sbt-test.sh
./.sbt-test.sh "set port in container.Configuration := 8081" container:start shell
