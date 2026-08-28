package com.codexpocket.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class BackNavigationTest {
    @Test
    public void activeComputerAlwaysReturnsToComputerPickerInsteadOfWebHistory() {
        assertEquals(BackNavigation.Action.SHOW_COMPUTER_PICKER, BackNavigation.action(true));
    }

    @Test
    public void computerPickerLetsAndroidCloseTheActivity() {
        assertEquals(BackNavigation.Action.EXIT_ACTIVITY, BackNavigation.action(false));
    }
}
