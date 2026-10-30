import { Capacitor, registerPlugin } from "@capacitor/core";
import { contactPickerKind, pickedContact, type PickedContact } from "@/lib/contactPick";

// The phone's own contact picker, without any permission: on Android the
// app's local plugin (android/.../ContactPickerPlugin.java, ACTION_PICK, the
// system grants the one row chosen), in Chrome on Android the Contact Picker
// API. Elsewhere (computer, Safari, iOS for now) the button is hidden.

type ContactPickerPlugin = { pick(): Promise<{ name?: string; phone?: string }> };

const NativePicker = registerPlugin<ContactPickerPlugin>("ContactPicker");

type WebContacts = { select(properties: string[], options?: { multiple?: boolean }): Promise<Array<{ name?: string[]; tel?: string[] }>> };

function webContacts(): WebContacts | null {
  if (typeof navigator === "undefined") return null;
  const contacts = (navigator as Navigator & { contacts?: Partial<WebContacts> }).contacts;
  return contacts && typeof contacts.select === "function" ? (contacts as WebContacts) : null;
}

/** "native", "web" or null (no button). Read in an effect or a store snapshot, never while server-rendering. */
export function contactPicker() {
  return contactPickerKind({
    plugin: Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ContactPicker"),
    webApi: !Capacitor.isNativePlatform() && webContacts() !== null,
  });
}

/** The contact chosen, or null when cancelled (or the picker failed: the field stays as it was). */
export async function pickContact(): Promise<PickedContact | null> {
  try {
    const kind = contactPicker();
    if (kind === "native") return pickedContact(await NativePicker.pick());
    if (kind === "web") {
      const [first] = (await webContacts()?.select(["name", "tel"], { multiple: false })) ?? [];
      return pickedContact(first);
    }
  } catch {
    // Cancelled, or not allowed here: nothing changes.
  }
  return null;
}
