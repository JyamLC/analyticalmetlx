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
}
