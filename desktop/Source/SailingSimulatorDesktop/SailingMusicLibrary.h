#pragma once

#include "CoreMinimal.h"

#if PLATFORM_MAC
class FSailingMusicLibrary
{
public:
    FSailingMusicLibrary();
    ~FSailingMusicLibrary();
    void Choose(bool bFolder);
    int32 Count() const;
    const FString& Title(int32 Track) const;
    const FString& Status() const;
    int32 CurrentTrack() const;
    bool Select(int32 Track);
    bool Playing() const;
    void SetActive(bool bActive);
    void SetVolume(float Gain);
    void Tick();

private:
    struct FLibrary;
    TUniquePtr<FLibrary> Library;
};
#endif
