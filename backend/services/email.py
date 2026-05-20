from __future__ import annotations

import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from logging import Logger

from flask import has_request_context, request as flask_request

from ..core import settings

EMAIL_PROVIDER_SMTP = "smtp"
EMAIL_PROVIDER_RESEND = "resend"
EMAIL_PROVIDER_BREVO = "brevo"
EMAIL_PROVIDER_TENCENTCLOUD = "tencentcloud"

_TENCENTCLOUD_SES_DEFAULT_REGION = "ap-guangzhou"


def get_available_email_providers() -> list[dict[str, str]]:
    providers: list[dict[str, str]] = []
    if settings.smtp_host:
        providers.append({"value": EMAIL_PROVIDER_SMTP, "label": "SMTP"})
    if settings.resend_api_key.strip():
        providers.append({"value": EMAIL_PROVIDER_RESEND, "label": "Resend"})
    if settings.brevo_api_key.strip():
        providers.append({"value": EMAIL_PROVIDER_BREVO, "label": "Brevo"})
    if (
        settings.tencentcloud_secret_id.strip()
        and settings.tencentcloud_secret_key.strip()
        and settings.email_from.strip()
        and settings.tencentcloud_template_id.strip()
    ):
        providers.append({"value": EMAIL_PROVIDER_TENCENTCLOUD, "label": "腾讯云 SES"})
    return providers


def resolve_email_provider(provider: str, available_providers: list[dict[str, str]] | None = None) -> str:
    options = available_providers if available_providers is not None else get_available_email_providers()
    selected = provider.strip().lower()
    if selected and any(option["value"] == selected for option in options):
        return selected
    return options[0]["value"] if options else ""


def _build_smtp_connection(logger: Logger) -> tuple[smtplib.SMTP | smtplib.SMTP_SSL, str] | tuple[None, str]:
    host = settings.smtp_host
    port = settings.smtp_port
    username = settings.smtp_username
    password = settings.smtp_password
    use_tls = settings.smtp_use_tls

    if not host:
        return None, "SMTP_HOST 未配置"

    try:
        use_ssl = (port == 465)
        if use_ssl:
            server: smtplib.SMTP | smtplib.SMTP_SSL = smtplib.SMTP_SSL(host, port, timeout=10)
        else:
            server = smtplib.SMTP(host, port, timeout=10)

        if not use_ssl and use_tls:
            server.starttls()
            server.ehlo()

        if username and password:
            server.login(username, password)

        return server, ""
    except smtplib.SMTPAuthenticationError:
        return None, "SMTP 认证失败，请检查用户名和密码"
    except smtplib.SMTPConnectError:
        return None, f"无法连接到 SMTP 服务器 {host}:{port}"
    except smtplib.SMTPException as exc:
        return None, f"SMTP 错误: {exc}"
    except Exception as exc:
        logger.exception("[SMTP] connection failed")
        return None, f"连接失败: {exc}"


def _send_smtp_email(to: str, subject: str, body: str, *, logger: Logger) -> tuple[bool, str]:
    server, err = _build_smtp_connection(logger)
    if server is None:
        return False, err

    from_addr = _default_email_from() or settings.smtp_username

    try:
        msg = MIMEMultipart()
        msg["From"] = from_addr
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))
        server.sendmail(from_addr, [to], msg.as_string())
        return True, "邮件已发送"
    except smtplib.SMTPException as exc:
        return False, f"SMTP 错误: {exc}"
    except Exception as exc:
        logger.exception("[SMTP] send failed")
        return False, f"发送失败: {exc}"
    finally:
        try:
            server.quit()
        except Exception:
            pass


def _read_error_message_from_body(raw: str, fallback_status: int | None = None) -> str:
    if not raw.strip():
        return f"HTTP {fallback_status}" if fallback_status is not None else "HTTP error"
    try:
        payload = json.loads(raw)
    except Exception:
        return raw.strip()
    if isinstance(payload, dict):
        response = payload.get("Response")
        if isinstance(response, dict):
            error = response.get("Error")
            if isinstance(error, dict):
                message = str(error.get("Message", "") or "").strip()
                code = str(error.get("Code", "") or "").strip()
                if message:
                    return f"{code}: {message}" if code else message
        for key in ("error", "message", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return raw.strip()


def _truncate(text: str, limit: int = 1200) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}... [truncated {len(text) - limit} chars]"


def _default_email_from() -> str:
    configured_from = settings.email_from.strip()
    if configured_from:
        return configured_from

    if has_request_context():
        host = (
            flask_request.headers.get("X-Forwarded-Host")
            or flask_request.headers.get("Host")
            or flask_request.host
            or ""
        ).split(",")[0].strip()
        host = host.split(":", 1)[0].strip()
        if host:
            return f"noreply@{host}"
    return "noreply@localhost"


def _build_resend_message_payload(from_addr: str, to: str, subject: str, body: str) -> dict[str, str]:
    return {
        "from": from_addr,
        "to": to,
        "subject": subject,
        "html": body,
    }


def _send_resend_email(to: str, subject: str, body: str, *, logger: Logger) -> tuple[bool, str]:
    try:
        import resend
    except Exception as exc:
        logger.exception("[Resend] import failed")
        return False, f"Resend SDK 未安装或导入失败: {exc}"

    api_key = settings.resend_api_key.strip()
    if not api_key:
        return False, "RESEND_API_KEY 未配置"

    from_addr = _default_email_from()
    logger.info(
        "[Resend] sending email to=%s from=%s subject=%s",
        to,
        from_addr,
        subject,
    )
    resend.api_key = api_key
    payload = _build_resend_message_payload(from_addr, to, subject, body)
    try:
        result = resend.Emails.send(payload)
        logger.info("[Resend] success response=%s", _truncate(repr(result), 4000))
        return True, "邮件已发送"
    except Exception as exc:
        response = getattr(exc, "response", None)
        if response is not None:
            response_body = getattr(response, "text", "") or getattr(response, "body", "") or ""
            status_code = getattr(response, "status_code", None) or getattr(response, "status", None)
            request_id = ""
            headers = getattr(response, "headers", None)
            if headers is not None:
                request_id = headers.get("x-request-id") or headers.get("x-resend-id") or ""
            logger.warning(
                "[Resend] http_error status=%s request_id=%s body=%s",
                status_code,
                request_id,
                _truncate(str(response_body), 4000),
            )
            return False, f"Resend 错误: {_read_error_message_from_body(str(response_body), status_code)}"
        logger.exception("[Resend] send failed")
        return False, f"发送失败: {exc}"


def _send_brevo_email(to: str, subject: str, body: str, *, logger: Logger) -> tuple[bool, str]:
    try:
        import sib_api_v3_sdk
        from sib_api_v3_sdk.rest import ApiException
    except Exception as exc:
        logger.exception("[Brevo] import failed")
        return False, f"Brevo SDK 未安装或导入失败: {exc}"

    api_key = settings.brevo_api_key.strip()
    if not api_key:
        return False, "BREVO_API_KEY 未配置"

    from_email = _default_email_from()
    from_name = settings.brevo_from_name.strip() or "ChatAPI"
    logger.info(
        "[Brevo] sending email to=%s from=%s sender_name=%s subject=%s",
        to,
        from_email,
        from_name,
        subject,
    )

    configuration = sib_api_v3_sdk.Configuration()
    configuration.api_key["api-key"] = api_key
    api_instance = sib_api_v3_sdk.TransactionalEmailsApi(sib_api_v3_sdk.ApiClient(configuration))

    sender = sib_api_v3_sdk.SendSmtpEmailSender(name=from_name, email=from_email)
    recipient = sib_api_v3_sdk.SendSmtpEmailTo(email=to)
    email = sib_api_v3_sdk.SendSmtpEmail(
        sender=sender,
        to=[recipient],
        subject=subject,
        html_content=body,
    )

    try:
        result = api_instance.send_transac_email(email)
        logger.info("[Brevo] success response=%s", _truncate(repr(result), 4000))
        return True, "邮件已发送"
    except ApiException as exc:
        raw_body = getattr(exc, "body", "") or ""
        logger.warning(
            "[Brevo] api_error status=%s reason=%s body=%s",
            getattr(exc, "status", ""),
            getattr(exc, "reason", ""),
            _truncate(str(raw_body), 4000),
        )
        return False, f"Brevo 错误: {_read_error_message_from_body(str(raw_body), getattr(exc, 'status', None))}"
    except Exception as exc:
        logger.exception("[Brevo] send failed")
        return False, f"发送失败: {exc}"


def _build_tencentcloud_template_data(
    *,
    subject: str,
    text_body: str,
    html_body: str | None,
    code: str = "",
) -> str:
    template_data: dict[str, str] = {
        "subject": subject,
        "title": subject,
        "content": text_body,
        "body": text_body,
        "text": text_body,
    }
    if html_body is not None:
        template_data["html"] = html_body
    if code:
        template_data["code"] = code
        template_data["verification_code"] = code
    return json.dumps(template_data, ensure_ascii=False, separators=(",", ":"))


def _send_tencentcloud_email(
    to: str,
    subject: str,
    text_body: str,
    *,
    html_body: str | None,
    trigger_type: int,
    code: str = "",
    logger: Logger,
) -> tuple[bool, str]:
    secret_id = settings.tencentcloud_secret_id.strip()
    secret_key = settings.tencentcloud_secret_key.strip()
    if not secret_id or not secret_key:
        return False, "TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY 未配置"

    from_addr = settings.email_from.strip()
    if not from_addr:
        return False, "CHATAPI_EMAIL_FROM 未配置"

    template_id_raw = settings.tencentcloud_template_id.strip()
    if not template_id_raw:
        return False, "CHATAPI_TENCENTCLOUD_TEMPLATE_ID 未配置"
    try:
        template_id = int(template_id_raw)
    except ValueError:
        return False, "CHATAPI_TENCENTCLOUD_TEMPLATE_ID 必须是整数"

    region = settings.tencentcloud_ses_region.strip() or _TENCENTCLOUD_SES_DEFAULT_REGION
    template_data = _build_tencentcloud_template_data(
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        code=code,
    )

    payload: dict[str, object] = {
        "FromEmailAddress": from_addr,
        "Destination": [to],
        "Subject": subject,
        "ReplyToAddresses": from_addr,
        "HeaderFrom": from_addr,
        "TriggerType": trigger_type,
        "Template": {
            "TemplateID": template_id,
            "TemplateData": template_data,
        },
    }
    logger.info(
        "[TencentCloud SES] sending email to=%s from=%s region=%s subject=%s",
        to,
        from_addr,
        region,
        subject,
    )
    try:
        from tencentcloud.common import credential
        from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.ses.v20201002 import models, ses_client
    except Exception as exc:
        logger.exception("[TencentCloud SES] import failed")
        return False, f"TencentCloud SDK 未安装或导入失败: {exc}"

    try:
        cred = credential.Credential(secret_id, secret_key)
        http_profile = HttpProfile()
        http_profile.endpoint = f"ses.{region}.tencentcloudapi.com"
        client_profile = ClientProfile()
        client_profile.httpProfile = http_profile
        client_profile.signMethod = "TC3-HMAC-SHA256"
        client = ses_client.SesClient(cred, region, client_profile)

        req = models.SendEmailRequest()
        req.from_json_string(json.dumps(payload, ensure_ascii=False))
        response = client.SendEmail(req)
        response_text = response.to_json_string()
        logger.info("[TencentCloud SES] success response=%s", _truncate(response_text, 4000))
        return True, "邮件已发送"
    except TencentCloudSDKException as exc:
        request_id = str(getattr(exc, "request_id", "") or getattr(exc, "requestId", "") or "").strip()
        code = str(getattr(exc, "code", "") or "").strip()
        message = str(getattr(exc, "message", "") or "").strip() or str(exc)
        logger.warning(
            "[TencentCloud SES] api_error code=%s request_id=%s message=%s",
            code,
            request_id,
            _truncate(message, 4000),
        )
        if code and message:
            return False, f"腾讯云 SES 错误: {code}: {message}"
        return False, f"腾讯云 SES 错误: {message}"
    except Exception as exc:
        logger.exception("[TencentCloud SES] send failed")
        return False, f"发送失败: {exc}"


def _send_email(
    provider: str,
    to: str,
    subject: str,
    text_body: str,
    *,
    html_body: str | None = None,
    trigger_type: int = 1,
    code: str = "",
    logger: Logger,
) -> tuple[bool, str]:
    selected_provider = resolve_email_provider(provider)
    if selected_provider == EMAIL_PROVIDER_RESEND:
        return _send_resend_email(to, subject, html_body or text_body, logger=logger)
    if selected_provider == EMAIL_PROVIDER_BREVO:
        return _send_brevo_email(to, subject, html_body or text_body, logger=logger)
    if selected_provider == EMAIL_PROVIDER_TENCENTCLOUD:
        return _send_tencentcloud_email(
            to,
            subject,
            text_body,
            html_body=html_body,
            trigger_type=trigger_type,
            code=code,
            logger=logger,
        )
    if selected_provider == EMAIL_PROVIDER_SMTP:
        return _send_smtp_email(to, subject, text_body, logger=logger)
    return False, "未配置可用的邮箱发送方式"


def send_test_email(to: str, *, provider: str = "", logger: Logger) -> tuple[bool, str]:
    body = "这是一封来自 ChatAPI 的测试邮件，说明邮箱发送配置正确。"
    html = "<p>这是一封来自 ChatAPI 的测试邮件，说明邮箱发送配置正确。</p>"
    selected_provider = resolve_email_provider(provider)
    return _send_email(
        selected_provider,
        to,
        "ChatAPI 测试邮件",
        body,
        html_body=html,
        trigger_type=0,
        logger=logger,
    )


def send_verification_email(to: str, code: str, *, provider: str = "", logger: Logger) -> tuple[bool, str]:
    subject = "ChatAPI 邮箱验证码"
    body = f"您的验证码是：{code}\n\n验证码 5 分钟内有效，请勿泄露给他人。"
    html = f"<p>您的验证码是：<strong>{code}</strong></p><p>验证码 5 分钟内有效，请勿泄露给他人。</p>"
    selected_provider = resolve_email_provider(provider)
    return _send_email(
        selected_provider,
        to,
        subject,
        body,
        html_body=html,
        trigger_type=1,
        code=code,
        logger=logger,
    )
