package uk.wakukusmartrecipe.soft;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NativeFiles")
public class NativeFilesPlugin extends Plugin {
    private final Map<String, OutputStream> outputs = new ConcurrentHashMap<>();

    @PluginMethod
    public void beginSave(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "beginSaveResult");
    }

    @ActivityCallback
    private void beginSaveResult(PluginCall call, ActivityResult result) {
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("No output file selected");
            return;
        }
        try {
            OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w");
            if (output == null) throw new IllegalStateException("Unable to open output file");
            String token = UUID.randomUUID().toString();
            outputs.put(token, output);
            response.put("token", token);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to open output file", error);
        }
    }

    @PluginMethod
    public void writeSaveChunk(PluginCall call) {
        String token = call.getString("token");
        String data = call.getString("data");
        Boolean last = call.getBoolean("final", false);
        OutputStream output = token == null ? null : outputs.get(token);
        if (output == null || data == null) {
            call.reject("Invalid output file");
            return;
        }
        getBridge().execute(() -> {
            try {
                if (!data.isEmpty()) output.write(Base64.decode(data, Base64.DEFAULT));
                if (Boolean.TRUE.equals(last)) {
                    output.flush();
                    output.close();
                    outputs.remove(token);
                }
                call.resolve();
            } catch (Exception error) {
                outputs.remove(token);
                try { output.close(); } catch (Exception ignored) {}
                call.reject("Unable to save file", error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (OutputStream output : outputs.values()) try { output.close(); } catch (Exception ignored) {}
        outputs.clear();
    }
}
