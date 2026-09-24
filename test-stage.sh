#!/usr/bin/env bash
# Team Chat v1 - promote to the TEST stage and run it (Mac/Linux version of test-stage.bat)
set -e
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
echo "=== Step 4: Starting MeTL (TEST stage) - open http://localhost:8080 ==="
sed "s|configuration.local.xml|configuration.test.xml|" sbt.sh > ./.sbt-test.sh && chmod +x ./.sbt-test.sh
./.sbt-test.sh container:start shell
