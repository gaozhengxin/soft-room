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
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NativeFiles")
public class NativeFilesPlugin extends Plugin {
    private static final int MAX_TEXT_FILE_BYTES = 4096;
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

    @PluginMethod
    public void openTextFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
        startActivityForResult(call, intent, "openTextFileResult");
    }

    @ActivityCallback
    private void openTextFileResult(PluginCall call, ActivityResult result) {
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("No input file selected");
            return;
        }
        getBridge().execute(() -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IllegalStateException("Unable to open input file");
                byte[] buffer = new byte[1024];
                int total = 0;
                for (int count; (count = input.read(buffer)) != -1;) {
                    total += count;
                    if (total > MAX_TEXT_FILE_BYTES) throw new IllegalArgumentException("Input file is too large");
                    output.write(buffer, 0, count);
                }
                response.put("text", output.toString(StandardCharsets.UTF_8.name()));
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Unable to read file", error);
            }
        });
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
