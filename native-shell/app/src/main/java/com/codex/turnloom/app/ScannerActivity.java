package com.codex.turnloom.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import com.journeyapps.barcodescanner.ViewfinderView;
import com.journeyapps.barcodescanner.camera.CameraSettings;

import java.util.Collections;
import java.util.List;

/**
 * Embedded, in-process ZXing camera scanner. It is not an external barcode
 * Intent: this Activity owns the camera preview and a live QR decoder, and
 * returns the original raw QR text (or an explicit denial/cancel/error code)
 * to the calling MainActivity.
 */
public final class ScannerActivity extends Activity {
    static final String EXTRA_REQUEST_ID = "requestId";
    static final String EXTRA_QR_VALUE = "qrValue";
    static final String EXTRA_ERROR_CODE = "errorCode";
    static final String EXTRA_ERROR_MESSAGE = "errorMessage";
    private static final int REQ_CAMERA = 0x51;

    private DecoratedBarcodeView scanner;
    private String requestId = "";
    private boolean finished = false;
    private boolean permissionDenied = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        Intent source = getIntent();
        requestId = source == null ? "" : source.getStringExtra(EXTRA_REQUEST_ID);
        if (!BridgeContract.validRequestId(requestId)) {
            qrError("invalid-request", "扫描请求无效");
            return;
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        // The journeyapps DecoratedBarcodeView is inflated programmatically.
        // Its internal BarcodeView + ViewfinderView are connected by the
        // library's own layout, giving a real camera preview and ZXing decoder.
        scanner = new DecoratedBarcodeView(this);
        root.addView(scanner, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setGravity(Gravity.CENTER_HORIZONTAL);
        controls.setPadding(32, 36, 32, 36);
        FrameLayout.LayoutParams controlParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        controlParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        root.addView(controls, controlParams);
        TextView hint = new TextView(this);
        hint.setText("将配对二维码放入取景框");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(16);
        controls.addView(hint);
        Button cancel = new Button(this);
        cancel.setText("取消");
        cancel.setOnClickListener(v -> qrCancel());
        controls.addView(cancel);
        setContentView(root);

        CameraSettings settings = new CameraSettings();
        settings.setAutoFocusEnabled(true);
        settings.setContinuousFocusEnabled(true);
        scanner.setCameraSettings(settings);
        scanner.setDecoderFactory(new DefaultDecoderFactory(
                Collections.singletonList(BarcodeFormat.QR_CODE), null, "UTF-8", 0));
        ViewfinderView finder = scanner.getViewFinder();
        if (finder != null) finder.setLaserVisibility(false);
        TextView status = scanner.getStatusView();
        if (status != null) status.setVisibility(android.view.View.GONE);

        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            beginScan();
        } else {
            permissionDenied = true;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    private void beginScan() {
        if (finished || scanner == null) return;
        scanner.resume();
        scanner.decodeSingle(new BarcodeCallback() {
            @Override
            public void barcodeResult(BarcodeResult result) {
                String raw = result == null ? "" : result.getText();
                qrSuccess(raw == null ? "" : raw);
            }

            @Override
            public void possibleResultPoints(List<ResultPoint> points) {
                // No logging of QR contents.
            }
        });
        scanner.getBarcodeView().addStateListener(new com.journeyapps.barcodescanner.CameraPreview.StateListener() {
            @Override public void previewSized() { }
            @Override public void previewStarted() { }
            @Override public void previewStopped() { }
            @Override public void cameraError(Exception error) {
                qrError("camera-error", "相机无法启动，请检查权限或设备相机");
            }
            @Override public void cameraClosed() { }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_CAMERA) return;
        permissionDenied = false;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) beginScan();
        else qrError("permission-denied", "需要相机权限才能扫描配对二维码");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (scanner != null && !permissionDenied && !finished
                && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            scanner.resume();
        }
    }

    @Override
    protected void onPause() {
        if (scanner != null) scanner.pauseAndWait();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (scanner != null) scanner.pauseAndWait();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        qrCancel();
    }

    private void qrSuccess(String value) {
        if (finished) return;
        finished = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_REQUEST_ID, requestId);
        data.putExtra(EXTRA_QR_VALUE, value);
        setResult(RESULT_OK, data);
        finish();
    }

    private void qrCancel() {
        if (finished) return;
        finished = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_REQUEST_ID, requestId);
        data.putExtra(EXTRA_QR_VALUE, "");
        setResult(RESULT_CANCELED, data);
        finish();
    }

    private void qrError(String code, String message) {
        if (finished) return;
        finished = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_REQUEST_ID, requestId);
        data.putExtra(EXTRA_ERROR_CODE, code);
        data.putExtra(EXTRA_ERROR_MESSAGE, message);
        setResult(RESULT_FIRST_USER, data);
        finish();
    }
}
