import { session } from "../session.js";
import { toast, confirmDialog } from "../ui.js";

/** Sign out, warning guests that their journal has no password. */
export async function confirmAndSignOut(navigate) {
  if (session.isGuest) {
    const ok = await confirmDialog({
      title: "Leave this guest journal?",
      message: "Guest journals have no password. Unless you've saved your recovery key (Settings → Recovery key), you won't be able to open this journal again. Create an account to keep it.",
      confirmLabel: "Leave journal", danger: true,
    });
    if (!ok) return;
  }
  await session.signOut();
  toast("Signed out", { type: "success" });
  navigate("sign-in");
}
