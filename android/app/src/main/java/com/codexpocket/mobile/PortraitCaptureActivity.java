package com.codexpocket.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.FrameLayout;

import com.journeyapps.barcodescanner.CaptureActivity;

public class PortraitCaptureActivity extends CaptureActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Button close = new Button(this);
        close.setText("‹");
        close.setTextSize(32);
        close.setTextColor(Color.WHITE);
        close.setBackgroundColor(Color.argb(150, 0, 0, 0));
        close.setContentDescription("关闭扫码");
        close.setOnClickListener(v -> finish());

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(52), dp(52));
        params.gravity = Gravity.TOP | Gravity.START;
        params.setMargins(dp(12), dp(18), 0, 0);
        addContentView(close, params);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
