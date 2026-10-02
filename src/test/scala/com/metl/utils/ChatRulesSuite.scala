package com.metl.utils

import org.scalatest.FunSuite

class ChatRulesSuite extends FunSuite {

  test("a normal message is valid") {
    assert(ChatRules.isValid("Hello team"))
  }

  test("an empty or whitespace-only message is rejected") {
    assert(!ChatRules.isValid(""))
    assert(!ChatRules.isValid("    "))
    assert(!ChatRules.isValid(null))
    assert(ChatRules.rejectionReason("  ") === Some("empty message"))
  }

  test("exactly 2,000 characters is allowed") {
    assert(ChatRules.isValid("a" * 2000))
    assert(ChatRules.rejectionReason("a" * 2000) === None)
  }

  test("2,001 characters is rejected") {
    assert(!ChatRules.isValid("a" * 2001))
    assert(ChatRules.rejectionReason("a" * 2001).isDefined)
  }

  test("surrounding spaces do not count toward the limit") {
    assert(ChatRules.isValid("  " + ("a" * 2000) + "  "))
    assert(ChatRules.clean("  hi  ") === "hi")
  }

  test("v2: text and file messages are the only content types accepted") {
    assert(ChatRules.rejectionReason("text", "hello @Ana") === None)
    assert(ChatRules.rejectionReason("html", "<b>hi</b>").isDefined)
    assert(ChatRules.rejectionReason(null, "hi").isDefined)
  }

  test("v2: a shared file must have an allowed extension") {
    assert(ChatRules.rejectionReason("file", """{"name":"plan.pdf","size":1200,"url":"abc"}""") === None)
    assert(ChatRules.rejectionReason("file", """{"name":"Photo.JPG","size":1200,"url":"abc"}""") === None)
    assert(ChatRules.rejectionReason("file", """{"name":"virus.exe","size":1200,"url":"abc"}""").isDefined)
    assert(ChatRules.rejectionReason("file", """{"size":1200}""").isDefined)
  }

  test("v2: file extension helper") {
    assert(ChatRules.fileExtension("a.b.PNG") === "png")
    assert(ChatRules.fileExtension("noextension") === "")
    assert(ChatRules.isAllowedFile("notes.txt"))
    assert(!ChatRules.isAllowedFile("script.sh"))
  }
}
