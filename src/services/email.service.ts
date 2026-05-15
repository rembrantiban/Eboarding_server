import { resend } from "../config/resend";

export async function sendTestEmail() {
  try {
    const response = await resend.emails.send({
      from: 'noreply@eboarding.site', 
      to: 'tadashirimura@gmail.com',
      subject: 'Test Email 🚀',
      html: '<h1>It works!</h1>',
    });

    console.log("Email sent:", response);
  } catch (error) {
    console.error("Email error:", error);
  }
}