package com.codexpocket.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FileChooserRequestsTest {
    @Test
    public void exactImageWildcardUsesPhotoPicker() {
        assertTrue(FileChooserRequests.isPhotoPickerRequest(new String[]{"image/*"}));
    }

    @Test
    public void explicitImageTypesUseFileBrowser() {
        assertFalse(FileChooserRequests.isPhotoPickerRequest(new String[]{"image/jpeg", "image/png"}));
    }

    @Test
    public void emptyAcceptTypesUseFileBrowser() {
        assertFalse(FileChooserRequests.isPhotoPickerRequest(new String[]{}));
        assertFalse(FileChooserRequests.isPhotoPickerRequest(null));
    }
}
