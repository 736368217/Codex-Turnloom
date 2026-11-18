package com.codex.turnloom.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.UriMatcher;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Narrow, non-exported, read-only provider for one validated staged APK.
 *
 * <p>The provider exposes exactly one virtual name, {@code pending.apk}, and
 * maps it to a private file inside getFilesDir()/updates. It grants the Android
 * installer a temporary read URI; arbitrary paths, external storage and write
 * operations are rejected. The URI is only handed out after package, signer,
 * version and digest validation in {@link UpdateManager}.</p>
 */
public final class UpdateFileProvider extends ContentProvider {
    static final String AUTHORITY_SUFFIX = ".updatefiles";
    private static final int VALIDATED_APK = 1;
    private final UriMatcher matcher = new UriMatcher(UriMatcher.NO_MATCH);

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public void attachInfo(Context context, ProviderInfo info) {
        super.attachInfo(context, info);
        matcher.addURI(info.authority, "pending.apk", VALIDATED_APK);
    }

    private File validatedApk() {
        Context context = getContext();
        if (context == null) return null;
        File dir = new File(context.getFilesDir(), "updates");
        File apk = new File(dir, "pending.apk");
        try {
            String root = dir.getCanonicalPath();
            if (!apk.getCanonicalPath().startsWith(root + File.separator)) return null;
        } catch (Exception e) {
            return null;
        }
        return apk.isFile() && apk.length() > 0 ? apk : null;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (matcher.match(uri) != VALIDATED_APK || !"r".equals(mode)) {
            throw new FileNotFoundException("unavailable");
        }
        File apk = validatedApk();
        if (apk == null) throw new FileNotFoundException("unavailable");
        return ParcelFileDescriptor.open(apk, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
            String[] selectionArgs, String sortOrder) {
        if (matcher.match(uri) != VALIDATED_APK) return null;
        File apk = validatedApk();
        if (apk == null) return null;
        String[] columns = projection == null
                ? new String[]{"_display_name", "_size"} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if ("_display_name".equals(columns[i])) row[i] = "Codex-Turnloom-update.apk";
            else if ("_size".equals(columns[i])) row[i] = apk.length();
            else row[i] = null;
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        return matcher.match(uri) == VALIDATED_APK
                ? "application/vnd.android.package-archive" : null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read-only");
    }
}
