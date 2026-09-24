package com.metl.utils

/**
  * Server-side rules for Team Chat messages (MeTL Real-Time Chat Enhancement, v1).
  * The browser checks the same limits (teamChat.js), but the server is the
  * authority so a modified client cannot bypass them.
  */
object ChatRules {
  val MaxLength = 2000

  def clean(content:String):String = Option(content).map(_.trim).getOrElse("")

  def isValid(content:String):Boolean = {
    val c = clean(content)
    c.nonEmpty && c.length <= MaxLength
  }

  def rejectionReason(content:String):Option[String] = {
    val c = clean(content)
    if (c.isEmpty) Some("empty message")
    else if (c.length > MaxLength) Some("message is %d characters; limit is %d".format(c.length, MaxLength))
    else None
  }
}
