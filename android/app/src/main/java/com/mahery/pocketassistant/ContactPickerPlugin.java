package com.mahery.pocketassistant;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Choisir dans mes contacts" (Prêts): the system's own contact picker, on
 * phone numbers. The system grants the app the one row chosen, for this
 * answer only, so no READ_CONTACTS permission is needed and nothing else in
 * the address book is read. Resolves { name, phone }, or {} when cancelled.
 */
@CapacitorPlugin(name = "ContactPicker")
public class ContactPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        try {
            startActivityForResult(call, intent, "picked");
        } catch (ActivityNotFoundException e) {
            // No contacts app on this phone: as if cancelled.
            call.resolve(new JSObject());
        }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject answer = new JSObject();
        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(answer);
            return;
        }
        String[] columns = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        try (Cursor cursor = getContext().getContentResolver().query(uri, columns, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                answer.put("name", cursor.getString(0));
                answer.put("phone", cursor.getString(1));
            }
        } catch (Exception e) {
            // The row couldn't be read: nothing is filled in.
        }
        call.resolve(answer);
    }
}
