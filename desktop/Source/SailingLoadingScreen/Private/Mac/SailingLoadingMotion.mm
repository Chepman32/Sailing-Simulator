#include "Mac/MacSystemIncludes.h"

namespace Sailing
{
bool PrefersReducedLoadingMotion()
{
    return [[NSWorkspace sharedWorkspace] accessibilityDisplayShouldReduceMotion];
}
}
