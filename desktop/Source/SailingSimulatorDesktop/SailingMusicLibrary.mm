#include "SailingMusicLibrary.h"

#if PLATFORM_MAC
#include "Apple/ScopeAutoreleasePool.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/GameUserSettings.h"
#include "Mac/CocoaThread.h"
#include "Mac/MacApplication.h"
#include "Misc/Base64.h"
#include "Misc/ConfigCacheIni.h"
#import <AVFoundation/AVFoundation.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

namespace
{
const TCHAR* const Section = TEXT("Sailing.Music");
const NSArray<NSString*>* MusicExtensions()
{
    return @[@"mp3", @"m4a", @"aac", @"wav", @"flac", @"aiff", @"aif"];
}

FString String(NSString* Value)
{
    return Value ? FString(UTF8_TO_TCHAR([Value UTF8String])) : FString();
}

class FScopedMusicURL
{
public:
    explicit FScopedMusicURL(NSURL* InURL) : URL([InURL retain]), bAccess([URL startAccessingSecurityScopedResource]) {}
    ~FScopedMusicURL()
    {
        if (bAccess) [URL stopAccessingSecurityScopedResource];
        [URL release];
    }
    NSURL* const URL;

private:
    const bool bAccess;
};

FString MakeBookmark(NSURL* URL)
{
    bool bScoped = true;
    NSData* Data = [URL bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope |
        NSURLBookmarkCreationSecurityScopeAllowOnlyReadAccess includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
    if (!Data)
    {
        bScoped = false;
        Data = [URL bookmarkDataWithOptions:NSURLBookmarkCreationMinimalBookmark
            includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
    }
    if (!Data) return {};
    return (bScoped ? TEXT("S") : TEXT("P")) + FBase64::Encode(static_cast<const uint8*>([Data bytes]), [Data length]);
}

NSURL* RestoreBookmark(const FString& Token, BOOL& bStale)
{
    TArray<uint8> Bytes;
    if (Token.Len() < 2 || !FBase64::Decode(Token.RightChop(1), Bytes)) return nil;
    NSData* Data = [NSData dataWithBytes:Bytes.GetData() length:Bytes.Num()];
    const auto Scope = Token[0] == TEXT('S') ? NSURLBookmarkResolutionWithSecurityScope : 0;
    return [NSURL URLByResolvingBookmarkData:Data options:Scope | NSURLBookmarkResolutionWithoutUI
        relativeToURL:nil bookmarkDataIsStale:&bStale error:nil];
}

TArray<FString> AudioFiles(NSURL* Root)
{
    TArray<FString> Files;
    NSNumber* IsDirectory = nil;
    [Root getResourceValue:&IsDirectory forKey:NSURLIsDirectoryKey error:nil];
    if (![IsDirectory boolValue])
    {
        if ([MusicExtensions() containsObject:[[Root pathExtension] lowercaseString]]) Files.Add(FString());
        return Files;
    }
    const auto Keys = @[NSURLIsRegularFileKey, NSURLIsSymbolicLinkKey];
    NSDirectoryEnumerator<NSURL*>* Entries = [[NSFileManager defaultManager] enumeratorAtURL:Root
        includingPropertiesForKeys:Keys options:NSDirectoryEnumerationSkipsHiddenFiles |
        NSDirectoryEnumerationSkipsPackageDescendants errorHandler:nil];
    const NSUInteger PrefixLength = [[Root path] length] + 1;
    for (NSURL* Entry in Entries)
    {
        if (![MusicExtensions() containsObject:[[Entry pathExtension] lowercaseString]]) continue;
        NSNumber* Regular = nil;
        NSNumber* Link = nil;
        [Entry getResourceValue:&Regular forKey:NSURLIsRegularFileKey error:nil];
        [Entry getResourceValue:&Link forKey:NSURLIsSymbolicLinkKey error:nil];
        if ([Regular boolValue] && ![Link boolValue] && [[Entry path] length] > PrefixLength)
            Files.Add(String([[Entry path] substringFromIndex:PrefixLength]));
    }
    Files.Sort([](const FString& A, const FString& B) { return A.Compare(B, ESearchCase::IgnoreCase) < 0; });
    return Files;
}

NSURL* TrackURL(NSURL* Root, const FString& Relative)
{
    return Relative.IsEmpty() ? Root : [Root URLByAppendingPathComponent:[NSString stringWithUTF8String:TCHAR_TO_UTF8(*Relative)]];
}
}

struct FSailingMusicLibrary::FLibrary
{
    struct FTrack
    {
        int32 Source;
        FString Relative, Title;
    };

    // Each source is a file or a folder the player selected.
    TArray<FString> Bookmarks;
    TArray<FTrack> Tracks;
    TSet<FString> Locations;
    FString Message;
    TUniquePtr<FScopedMusicURL> Access;
    AVAudioPlayer* Voice = nil;
    int32 Current = INDEX_NONE;
    float Gain = 1.f;
    bool bActive = false;

    ~FLibrary() { Unload(); }

    void Unload()
    {
        [Voice stop];
        [Voice release];
        Voice = nil;
        Access.Reset();
    }

    void AddSource(NSURL* URL, const FString& Token)
    {
        if (!URL) return;
        const FScopedMusicURL Scope(URL);
        const int32 Source = Bookmarks.Num();
        for (FString& Relative : AudioFiles(URL))
        {
            NSURL* File = TrackURL(URL, Relative);
            const FString Path = String([File path]);
            if (Locations.Contains(Path)) continue;
            Locations.Add(Path);
            Tracks.Add({Source, MoveTemp(Relative), String([[File URLByDeletingPathExtension] lastPathComponent])});
        }
        if (!Tracks.IsEmpty() && Tracks.Last().Source == Source) Bookmarks.Add(Token);
    }
};

FSailingMusicLibrary::FSailingMusicLibrary() : Library(MakeUnique<FLibrary>())
{
    SCOPED_AUTORELEASE_POOL;
    TArray<FString> Saved;
    GConfig->GetArray(Section, TEXT("Sources"), Saved, GGameUserSettingsIni);
    bool bRefresh = false;
    for (const FString& Token : Saved)
    {
        BOOL bStale = NO;
        NSURL* URL = RestoreBookmark(Token, bStale);
        if (!URL) continue;
        if (bStale)
        {
            const FScopedMusicURL Read(URL);
            const FString Fresh = MakeBookmark(URL);
            if (!Fresh.IsEmpty())
            {
                Library->AddSource(URL, Fresh);
                bRefresh = true;
                continue;
            }
        }
        Library->AddSource(URL, Token);
    }
    if (bRefresh && Saved.Num() == Library->Bookmarks.Num())
        GConfig->SetArray(Section, TEXT("Sources"), Library->Bookmarks, GGameUserSettingsIni);
    if (Library->Tracks.IsEmpty() && !Saved.IsEmpty()) Library->Message = TEXT("Music is unavailable. Select the files again.");
}

FSailingMusicLibrary::~FSailingMusicLibrary() = default;

void FSailingMusicLibrary::Choose(bool bFolder)
{
    if (!FSlateApplication::IsInitialized()) return;
    auto* Application = static_cast<FMacApplication*>(FSlateApplication::Get().GetPlatformApplication().Get());
    Application->SetCapture(nullptr);
    Application->SystemModalMode(true);
    NSArray<NSURL*>* Choices = MainThreadReturn(^{
        SCOPED_AUTORELEASE_POOL;
        NSOpenPanel* Panel = [NSOpenPanel openPanel];
        [Panel setTitle:bFolder ? @"Choose a music folder" : @"Choose music files"];
        [Panel setCanChooseFiles:!bFolder];
        [Panel setCanChooseDirectories:bFolder];
        [Panel setCanCreateDirectories:NO];
        [Panel setAllowsMultipleSelection:!bFolder];
        if (!bFolder)
        {
            NSMutableArray<UTType*>* Types = [NSMutableArray array];
            for (NSString* Extension in MusicExtensions())
                if (UTType* Type = [UTType typeWithFilenameExtension:Extension]) [Types addObject:Type];
            [Panel setAllowedContentTypes:Types];
        }
        const NSInteger Reply = [Panel runModal];
        NSArray<NSURL*>* Result = Reply == NSModalResponseOK ? [[Panel URLs] copy] : nil;
        [Panel close];
        return Result;
    });
    Application->SystemModalMode(false);
    Application->ResetModifierKeys();
    if (!Choices) return;

    SCOPED_AUTORELEASE_POOL;
    const int32 Before = Count();
    for (NSURL* URL in Choices)
    {
        const FString Token = MakeBookmark(URL);
        if (!Token.IsEmpty()) Library->AddSource(URL, Token);
        [URL stopAccessingSecurityScopedResource];
    }
    [Choices release];
    const int32 Added = Count() - Before;
    if (Added > 0)
    {
        GConfig->SetArray(Section, TEXT("Sources"), Library->Bookmarks, GGameUserSettingsIni);
        GConfig->Flush(false, GGameUserSettingsIni);
        Library->Message = FString::Printf(TEXT("Added %d %s"), Added, Added == 1 ? TEXT("track") : TEXT("tracks"));
    }
    else Library->Message = TEXT("No new supported tracks found.");
}

int32 FSailingMusicLibrary::Count() const { return Library->Tracks.Num(); }
const FString& FSailingMusicLibrary::Title(int32 Track) const { return Library->Tracks[Track].Title; }
const FString& FSailingMusicLibrary::Status() const { return Library->Message; }
int32 FSailingMusicLibrary::CurrentTrack() const { return Library->Current; }
bool FSailingMusicLibrary::Playing() const { return Library->bActive && [Library->Voice isPlaying]; }

bool FSailingMusicLibrary::Select(int32 Index)
{
    if (!Library->Tracks.IsValidIndex(Index)) return false;
    SCOPED_AUTORELEASE_POOL;
    const auto& Track = Library->Tracks[Index];
    BOOL bStale = NO;
    NSURL* URL = RestoreBookmark(Library->Bookmarks[Track.Source], bStale);
    auto Read = MakeUnique<FScopedMusicURL>(URL);
    AVAudioPlayer* Next = URL ? [[AVAudioPlayer alloc] initWithContentsOfURL:TrackURL(URL, Track.Relative) error:nil] : nil;
    if (!Next)
    {
        Library->Message = FString::Printf(TEXT("Unable to play %s"), *Track.Title);
        return false;
    }
    Library->Unload();
    Library->Access = MoveTemp(Read);
    Library->Voice = Next;
    Library->Current = Index;
    Library->Message.Empty();
    [Next setVolume:Library->Gain];
    if (Library->bActive) [Next play];
    return true;
}

void FSailingMusicLibrary::SetActive(bool bActive)
{
    if (Library->bActive == bActive) return;
    Library->bActive = bActive;
    if (bActive) [Library->Voice play];
    else [Library->Voice pause];
}

void FSailingMusicLibrary::SetVolume(float Gain)
{
    Library->Gain = Gain;
    [Library->Voice setVolume:Gain];
}

void FSailingMusicLibrary::Tick()
{
    if (!Library->bActive || !Library->Voice || Playing()) return;
    const int32 Current = Library->Current;
    for (int32 Offset = 1; Offset <= Count(); ++Offset)
        if (Select((Current + Offset) % Count())) return;
    Library->Unload();
}
#endif
