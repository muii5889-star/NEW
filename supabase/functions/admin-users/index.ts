// إدارة المستخدمين (إنشاء / تعديل / حذف) — تعمل على سيرفر Supabase فقط
// لأن إنشاء الحسابات يحتاج المفتاح السري (service role) ولا يجوز وضعه في المتصفح.
// الاسم في Supabase يجب أن يكون: admin-users
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PERMS = ["can_insert", "can_edit", "can_delete", "can_yearly"] as const;
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) التحقق أن الطالب مدير فعّال
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: "انتهت الجلسة، سجّل الدخول من جديد" }, 401);
    const { data: me } = await admin.from("profiles").select("role,active").eq("id", user.id).single();
    if (!me || me.role !== "admin" || !me.active) return json({ error: "هذه العملية للمدير فقط" }, 403);

    const b = await req.json();
    const role = b.role === "admin" ? "admin" : "user";
    const perms: Record<string, boolean> = {};
    for (const p of PERMS) if (p in b) perms[p] = b[p] === true;
    const name = typeof b.full_name === "string" ? b.full_name.trim().slice(0, 80) : undefined;

    // 2) تنفيذ العملية
    if (b.action === "create") {
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!emailOk(email)) return json({ error: "البريد الإلكتروني غير صحيح" }, 400);
      if (password.length < 8) return json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: name || "" },
      });
      if (error) return json({ error: /already/i.test(error.message) ? "هذا البريد مسجّل مسبقاً" : error.message }, 400);
      const { error: pErr } = await admin.from("profiles")
        .update({ full_name: name || "", role, ...perms, active: true }).eq("id", data.user.id);
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ ok: true, id: data.user.id });
    }

    if (b.action === "update") {
      const id = String(b.id || "");
      const active = b.active !== false;
      if (id === user.id && (role !== "admin" || !active))
        return json({ error: "لا يمكنك إزالة صلاحية المدير أو إيقاف حسابك بنفسك" }, 400);
      const patch: Record<string, unknown> = { role, active, ...perms };
      if (name !== undefined) patch.full_name = name;
      const { error } = await admin.from("profiles").update(patch).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      const authPatch: Record<string, unknown> = { ban_duration: active ? "none" : "876000h" };
      if (b.password) {
        if (String(b.password).length < 8) return json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }, 400);
        authPatch.password = String(b.password);
      }
      const { error: aErr } = await admin.auth.admin.updateUserById(id, authPatch);
      if (aErr) return json({ error: aErr.message }, 400);
      return json({ ok: true });
    }

    if (b.action === "delete") {
      const id = String(b.id || "");
      if (id === user.id) return json({ error: "لا يمكنك حذف حسابك بنفسك" }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "عملية غير معروفة" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
