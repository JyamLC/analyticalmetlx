package com.metl.utils

/**
  * Server-side rules for Team Chat messages (MeTL Real-Time Chat Enhancement).
  * The browser checks the same limits (teamChat.js), but the server is the
  * authority so a modified client cannot bypass them.
  *
  * v1: message text must be 1 to 2,000 characters.
  * v2: only "text" and "file" messages are accepted from the chat panel, and a
  *     shared file must have an allowed extension.
  */
object ChatRules {
  val MaxLength = 2000
  val AllowedContentTypes = List("text","file")
  val AllowedFileExtensions = List("png","jpg","jpeg","gif","pdf","txt","csv","doc","docx","xls","xlsx","ppt","pptx")

  private val FileNamePattern = """"name"\s*:\s*"([^"]*)"""".r

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

  def fileExtension(fileName:String):String = {
    val n = Option(fileName).getOrElse("")
    val dot = n.lastIndexOf(".")
    if (dot < 0) "" else n.substring(dot + 1).toLowerCase
  }

  def isAllowedFile(fileName:String):Boolean = AllowedFileExtensions.contains(fileExtension(fileName))

  def fileNameFrom(content:String):Option[String] = FileNamePattern.findFirstMatchIn(clean(content)).map(_.group(1))

  def rejectionReason(contentType:String, content:String):Option[String] = {
    val ct = Option(contentType).getOrElse("")
    if (!AllowedContentTypes.contains(ct)) Some("content type '%s' is not allowed".format(ct))
    else rejectionReason(content).orElse({
      if (ct == "file") {
        fileNameFrom(content) match {
          case Some(name) if isAllowedFile(name) => None
          case Some(name) => Some("file type '.%s' is not allowed".format(fileExtension(name)))
          case None => Some("file message has no file name")
        }
      } else None
    })
  }
}
