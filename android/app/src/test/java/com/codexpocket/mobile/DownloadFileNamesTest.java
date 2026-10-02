package com.codexpocket.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class DownloadFileNamesTest {
    @Test
    public void prefersExplicitUtf8NameFromDownloadUrl() {
        String url = "https://example.test/api/local-file?path=C%3A%5Ctmp%5Creport.xlsx&name=%E6%B5%8B%E8%AF%95%E6%8A%A5%E5%91%8A.xlsx";

        assertEquals("测试报告.xlsx", DownloadFileNames.resolve(url, null, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    }

    @Test
    public void parsesRfc5987ContentDisposition() {
        String disposition = "attachment; filename=\"report.xlsx\"; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%8A%A5%E5%91%8A.xlsx";

        assertEquals("测试报告.xlsx", DownloadFileNames.resolve("https://example.test/api/local-file", disposition, "application/octet-stream"));
    }

    @Test
    public void stripsUnsafePathCharacters() {
        String url = "https://example.test/api/local-file?name=..%2Fprivate%5Creport%3F.txt";

        assertEquals(".._private_report_.txt", DownloadFileNames.resolve(url, null, "text/plain"));
    }
}
