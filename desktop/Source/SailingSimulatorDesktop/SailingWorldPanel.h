#pragma once
#include "Templates/SharedPointer.h"

class ASailingPlayerController;
class SWidget;
TSharedRef<SWidget> MakeSailingWorldPanel(ASailingPlayerController& Player);
TSharedRef<SWidget> MakeSailingPausePanel(ASailingPlayerController& Player);
