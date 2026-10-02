package com.codexpocket.mobile;

final class BackNavigation {
    enum Action {
        SHOW_COMPUTER_PICKER,
        EXIT_ACTIVITY
    }

    private BackNavigation() {
    }

    static Action action(boolean hasActiveComputer) {
        return hasActiveComputer ? Action.SHOW_COMPUTER_PICKER : Action.EXIT_ACTIVITY;
    }
}
