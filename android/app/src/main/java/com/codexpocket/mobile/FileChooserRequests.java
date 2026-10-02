package com.codexpocket.mobile;

final class FileChooserRequests {
    private FileChooserRequests() {}

    static boolean isPhotoPickerRequest(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length != 1) return false;
        return "image/*".equalsIgnoreCase(acceptTypes[0] == null ? "" : acceptTypes[0].trim());
    }
}
