import type { MessageTemplateKey } from "@mc/shared";

/** Default WhatsApp click-to-chat templates (spec §13). Centers can edit them in Settings. */
export const DEFAULT_TEMPLATES: Record<MessageTemplateKey, { ar: string; en: string }> = {
  confirmation: {
    en: "Hello {patient_name}, your {booking_type} with {doctor_name} is confirmed for {date} at {time}. Fee: {price} (cash). Ref: {reference}. Location: {map_url} — {center_name}",
    ar: "مرحباً {patient_name}، تم تأكيد موعد {booking_type} مع {doctor_name} يوم {date} الساعة {time}. الرسوم: {price} (نقداً). رقم الحجز: {reference}. الموقع: {map_url} — {center_name}",
  },
  reminder: {
    en: "Reminder: your appointment with {doctor_name} is on {date} at {time}. To change it, please reply to this message. — {center_name}",
    ar: "تذكير: موعدك مع {doctor_name} يوم {date} الساعة {time}. للتعديل يرجى الرد على هذه الرسالة. — {center_name}",
  },
  rescheduled: {
    en: "Your appointment with {doctor_name} has been moved to {date} at {time}. Ref: {reference}. — {center_name}",
    ar: "تم تغيير موعدك مع {doctor_name} إلى يوم {date} الساعة {time}. رقم الحجز: {reference}. — {center_name}",
  },
  cancelled: {
    en: "Your appointment with {doctor_name} on {date} at {time} has been cancelled. Contact us to book another time. — {center_name}",
    ar: "تم إلغاء موعدك مع {doctor_name} يوم {date} الساعة {time}. تواصل معنا لحجز موعد آخر. — {center_name}",
  },
  request_followup: {
    en: "Hello {patient_name}, we received your request to see {doctor_name}. Which day and time suit you? — {center_name}",
    ar: "مرحباً {patient_name}، استلمنا طلبك لحجز موعد مع {doctor_name}. ما اليوم والوقت المناسب لك؟ — {center_name}",
  },
};
