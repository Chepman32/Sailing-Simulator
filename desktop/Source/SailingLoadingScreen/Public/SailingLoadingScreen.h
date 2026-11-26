#pragma once

#include "Templates/SharedPointer.h"

class SWidget;

namespace Sailing
{
    SAILINGLOADINGSCREEN_API bool CanShowLoadingScreen();
    SAILINGLOADINGSCREEN_API TSharedRef<SWidget> MakeLoadingScreen();
}
