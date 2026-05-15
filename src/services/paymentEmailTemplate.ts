export const paymentTemplate = (p: any, title: string, subtitle: string) => {
  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0; padding:0; background-color:#f4f6f8; font-family:Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
      <tr>
        <td align="center">

          <table width="600" cellpadding="0" cellspacing="0"
            style="background:#ffffff; border-radius:12px; padding:30px; box-shadow:0 5px 20px rgba(0,0,0,0.05);">

            <tr>
              <td align="center" style="padding-bottom:20px;">
                <h2 style="margin:0; color:#526CCB;">E-BOARDING</h2>
                <p style="margin:0; color:#333;">${title}</p>
                <p style="margin:5px 0 0; color:#888;">${subtitle}</p>
              </td>
            </tr>

            <tr>
              <td style="border-top:1px solid #eee; padding-top:20px;"></td>
            </tr>

            <tr>
              <td style="color:#555; font-size:15px; line-height:1.6;">
                Hi <strong>${p.first_name}</strong>,<br/><br/>

                This is a friendly reminder regarding your payment.<br/><br/>

                <strong>Details:</strong><br/>
                • Amount Due: <strong>₱${Number(p.amount).toLocaleString()}</strong><br/>
                • Due Date: <strong>${new Date(p.due_date).toLocaleDateString()}</strong><br/>
                • Room/Unit: <strong>${p.room_number} • Bed ${p.bed_number}</strong><br/><br/>

                Please settle your payment on time.
              </td>
            </tr>

            <tr>
              <td style="border-top:1px solid #eee; padding-top:20px; text-align:center; font-size:12px; color:#999;">
                If you already paid, please ignore this message.<br/><br/>
                © ${new Date().getFullYear()} E-Boarding House
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
};