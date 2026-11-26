#include "SailingWorldPanel.h"
#include "SailingMusicLibrary.h"
#include "SailingPlayerController.h"
#include "SailingWeather.h"
#include "SailingVoyageSound.h"
#include "SailingTrial.h"
#include "SailingExplorer.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Input/SSlider.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/Layout/SWidgetSwitcher.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
FText ResolutionLabel(FIntPoint Size, FIntPoint Desktop)
{
    if (Size == FIntPoint::ZeroValue) return FText::FromString(TEXT("Adaptive"));
    return FText::FromString(FString::Printf(TEXT("%d × %d%s"), Size.X, Size.Y, Size == Desktop ? TEXT(" · Native") : TEXT("")));
}

const FLinearColor TextInk(.86f, .95f, .94f);
const FLinearColor TextQuiet(.55f, .73f, .75f);
const FLinearColor Seafoam(.32f, .91f, .79f);

const FButtonStyle& PanelButtonStyle()
{
    static const FButtonStyle Style = FButtonStyle(FCoreStyle::Get().GetWidgetStyle<FButtonStyle>("Button"))
        .SetNormal(FSlateRoundedBoxBrush(FLinearColor(.84f,.84f,.84f),4.f))
        .SetHovered(FSlateRoundedBoxBrush(FLinearColor::White,4.f,FLinearColor(.80f,.93f,.94f),1.f))
        .SetPressed(FSlateRoundedBoxBrush(FLinearColor(.68f,.68f,.68f),4.f))
        .SetNormalPadding(FMargin(0)).SetPressedPadding(FMargin(0));
    return Style;
}

TSharedRef<SWidget> ChoiceGrid(TWeakObjectPtr<ASailingPlayerController> Player, EWorldSetting Setting,
    TConstArrayView<const TCHAR*> Labels, int32 Columns)
{
    auto Grid = SNew(SUniformGridPanel).SlotPadding(FMargin(0, 1, 4, 2));
    for (int32 Index = 0; Index < Labels.Num(); ++Index)
    {
        Grid->AddSlot(Index % Columns, Index / Columns)
        [SNew(SButton).ButtonStyle(&PanelButtonStyle()).HAlign(HAlign_Center).ContentPadding(FMargin(3, 7))
            .ButtonColorAndOpacity_Lambda([Player, Setting, Index] {
                return Player.IsValid() && Player->WorldChoiceSelected(Setting, Index)
                    ? FLinearColor(.024f, .27f, .21f) : FLinearColor(.028f, .054f, .081f); })
            .OnClicked_Lambda([Player, Setting, Index] {
                if (Player.IsValid()) Player->SetWorldChoice(Setting, Index);
                return FReply::Handled(); })
            [SNew(STextBlock).Text(FText::FromString(Labels[Index])).Font(FCoreStyle::GetDefaultFontStyle("Regular", 11))
             .ColorAndOpacity(FLinearColor::White)]];
    }
    return Grid;
}

class SSailingGraphics : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SSailingGraphics) {}
    SLATE_END_ARGS()

    void Construct(const FArguments&, ASailingPlayerController* InPlayer, bool bPaused)
    {
        Player = InPlayer;
        const TCHAR* Presets[] = {TEXT("Auto"), TEXT("Low"), TEXT("Medium"), TEXT("High"), TEXT("Ultra")};
        const auto Selected = RefreshResolutions();
        ChildSlot[SNew(SVerticalBox)
            + SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 4)
            [SNew(STextBlock).Text(FText::FromString(bPaused ? TEXT("Quality preset") : TEXT("Graphics")))
                .Font(FCoreStyle::GetDefaultFontStyle("Bold", 11)).ColorAndOpacity(TextQuiet)]
            + SVerticalBox::Slot().AutoHeight()[ChoiceGrid(Player, EWorldSetting::Graphics, MakeArrayView(Presets), 5)]
            + SVerticalBox::Slot().AutoHeight().Padding(0, bPaused ? 16 : 5, 4, 2)
            [SNew(SHorizontalBox)
                + SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)
                [SNew(STextBlock).Text(FText::FromString(TEXT("Render resolution")))
                    .Font(FCoreStyle::GetDefaultFontStyle("Regular", 11)).ColorAndOpacity(TextQuiet)]
                + SHorizontalBox::Slot().AutoWidth()
                [SNew(SBox).WidthOverride(215)
                    [SAssignNew(Combo, SComboBox<TSharedPtr<FIntPoint>>)
                        .OptionsSource(&Resolutions)
                        .InitiallySelectedItem(Selected)
                        .IsEnabled_Lambda([this] { return Player.IsValid() && Player->CanChangeResolution(); })
                        .ToolTipText(FText::FromString(TEXT("The scene scales to fill the display. The selected size limits rendering while preserving the display's aspect ratio.")))
                        .MaxListHeight(270)
                        .ContentPadding(FMargin(8, 5))
                        .OnComboBoxOpening_Lambda([this] {
                            TGuardValue<bool> Refreshing(bRefreshing, true);
                            const auto Current = RefreshResolutions();
                            Combo->RefreshOptions();
                            Combo->SetSelectedItem(Current);
                        })
                        .OnGenerateWidget_Lambda([this](TSharedPtr<FIntPoint> Size) {
                            return SNew(STextBlock).Text(ResolutionLabel(*Size, Desktop))
                                .Font(FCoreStyle::GetDefaultFontStyle("Regular", 11)); })
                        .OnSelectionChanged_Lambda([this](TSharedPtr<FIntPoint> Size, ESelectInfo::Type) {
                            if (!bRefreshing && Player.IsValid() && Size.IsValid()) Player->SetWorldResolution(*Size); })
                        [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular", 11))
                            .Text_Lambda([this] {
                                return Player.IsValid() ? ResolutionLabel(Player->WorldResolution(), Desktop) : FText::GetEmpty();
                            })]]]]];
    }

private:
    TSharedPtr<FIntPoint> RefreshResolutions()
    {
        TSharedPtr<FIntPoint> Selected;
        Resolutions.Reset();
        if (!Player.IsValid()) return Selected;
        auto Display = Player->WorldDisplayModes();
        Desktop = Display.Desktop;
        Display.Sizes.Insert(FIntPoint::ZeroValue, 0);
        const FIntPoint Current = Player->WorldResolution();
        for (FIntPoint Size : Display.Sizes)
        {
            const auto Option = MakeShared<FIntPoint>(Size);
            Resolutions.Add(Option);
            if (Size == Current) Selected = Option;
        }
        return Selected;
    }
    TWeakObjectPtr<ASailingPlayerController> Player;
    TSharedPtr<SComboBox<TSharedPtr<FIntPoint>>> Combo;
    TArray<TSharedPtr<FIntPoint>> Resolutions;
    FIntPoint Desktop = FIntPoint::ZeroValue;
    bool bRefreshing = false;
};

class SSailingWorldPanel : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SSailingWorldPanel) {}
    SLATE_END_ARGS()

    void Construct(const FArguments&, ASailingPlayerController* InPlayer)
    {
        Player=InPlayer;
        static const FSlateRoundedBoxBrush Card(FLinearColor(.013f,.032f,.052f,.96f),10.f,
            FLinearColor(.23f,.34f,.43f,.86f),1.f);
        TSharedRef<SVerticalBox> Rows=SNew(SVerticalBox);
        const auto Group=[&](const TCHAR* Title,EWorldSetting Setting,std::initializer_list<const TCHAR*> Labels,int32 Columns)
        {
            Rows->AddSlot().AutoHeight().Padding(0,10,0,4)
                [SNew(STextBlock).Text(FText::FromString(Title)).Font(FCoreStyle::GetDefaultFontStyle("Bold",11))
                 .ColorAndOpacity(FLinearColor(.69f,.81f,.83f))];
            TArray<const TCHAR*> Choices;
            if (Setting==EWorldSetting::Weather)
                for (int32 I = 0; I <= ASailingWeather::CalmChoice; ++I) Choices.Add(ASailingWeather::WeatherName(I));
            for (const TCHAR* Label : Labels) Choices.Add(Label);
            Rows->AddSlot().AutoHeight()[ChoiceGrid(Player, Setting, Choices, Columns)];
        };
        Group(TEXT("Time of day"),EWorldSetting::Lighting,{TEXT("Day"),TEXT("Golden hour"),TEXT("Night"),TEXT("Auto")},4);
        Group(TEXT("Weather"),EWorldSetting::Weather,{},5);
        Group(TEXT("Sound"),EWorldSetting::Audio,{TEXT("Master"),TEXT("Engine"),TEXT("‹ Radio"),TEXT("Radio ›")},4);
        Rows->AddSlot().AutoHeight().Padding(0,2,0,0)
            [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular",10)).ColorAndOpacity(FLinearColor(.65f,.77f,.80f))
             .Text_Lambda([this] {
                 if (!Player.IsValid()) return FText::GetEmpty();
                 const auto& Sound=Player->Sound();
                 return FText::FromString(FString::Printf(TEXT("Sound %s   ·   Engine %s   ·   %s"),
                    Sound.Enabled()?TEXT("on"):TEXT("off"), Sound.EngineAudible()?TEXT("on"):TEXT("off"),*Sound.StationLabel())); })];
        Rows->AddSlot().AutoHeight()[SNew(SSailingGraphics, InPlayer, false)];
        if (const auto* Yacht=Player->GetPawn<ASailingYachtPawn>(); Yacht && !Yacht->Explorer().Away())
            Group(TEXT("Camera"),EWorldSetting::Camera,{TEXT("Chase"),TEXT("Helm"),TEXT("Orbit"),TEXT("Drone")},4);

        ChildSlot[SNew(SOverlay)
            +SOverlay::Slot()[SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
                .BorderBackgroundColor(FLinearColor(0,.008f,.012f,.28f))
                .OnMouseButtonDown_Lambda([this](const FGeometry&,const FPointerEvent&) { Close(); return FReply::Handled(); })]
            +SOverlay::Slot().HAlign(HAlign_Right).VAlign(VAlign_Top).Padding(12)
            [SNew(SBox).WidthOverride(464).MaxDesiredHeight(550)
                [SNew(SBorder).BorderImage(&Card).Padding(16).OnMouseButtonDown_Lambda(
                    [](const FGeometry&,const FPointerEvent&) { return FReply::Handled(); })
                 [SNew(SVerticalBox)
                  +SVerticalBox::Slot().AutoHeight()
                  [SNew(SHorizontalBox)
                   +SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)
                   [SNew(STextBlock).Text(FText::FromString(TEXT("World controls"))).Font(FCoreStyle::GetDefaultFontStyle("Bold",19))]
                   +SHorizontalBox::Slot().AutoWidth()
                   [SNew(SButton).ButtonStyle(&PanelButtonStyle()).ContentPadding(FMargin(10,5)).ButtonColorAndOpacity(FLinearColor(.028f,.054f,.081f))
                    .Text(FText::FromString(TEXT("Close"))).OnClicked_Lambda([this] { Close(); return FReply::Handled(); })]]
                  +SVerticalBox::Slot().AutoHeight().Padding(0,4,0,2)
                  [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular",11)).ColorAndOpacity(FLinearColor(.49f,.86f,.77f))
                   .Text_Lambda([this] { return Player.IsValid() ? FText::FromString(Player->WorldReadout()) : FText::GetEmpty(); })]
                  +SVerticalBox::Slot().FillHeight(1)[SNew(SScrollBox)+SScrollBox::Slot()[Rows]]]]]];
    }

    bool SupportsKeyboardFocus() const override { return true; }
    FReply OnPreviewKeyDown(const FGeometry& Geometry,const FKeyEvent& Event) override
    {
        if (Event.GetKey()==EKeys::Escape || Event.GetKey()==EKeys::Comma)
        {
            if (!Event.IsRepeat()) Close();
            return FReply::Handled();
        }
        if (Event.GetKey()==EKeys::M)
        {
            if (Player.IsValid() && !Event.IsRepeat()) Player->SetWorldChoice(EWorldSetting::Audio,0);
            return FReply::Handled();
        }
        return SCompoundWidget::OnPreviewKeyDown(Geometry,Event);
    }
private:
    TWeakObjectPtr<ASailingPlayerController> Player;
    void Close() { if (Player.IsValid()) Player->ToggleWorld(); }
};

class SSailingPausePanel : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SSailingPausePanel) {}
    SLATE_END_ARGS()

    void Construct(const FArguments&, ASailingPlayerController* InPlayer)
    {
        Player = InPlayer;
        static const FSlateRoundedBoxBrush Card(FLinearColor(.012f, .034f, .044f, .98f), 10.f,
            FLinearColor(.12f, .28f, .30f), 1.f);
        const auto Header =
            SNew(SHorizontalBox)
            + SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)
            [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Bold", 27)).ColorAndOpacity(TextInk)
                .Text_Lambda([this] {
                    const TCHAR* Titles[] = {TEXT("Paused"), TEXT("Graphics settings"), TEXT("Sound settings"), TEXT("My music")};
                    return FText::FromString(Titles[PageIndex()]);
                })]
            + SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
            [Button(TAttribute<FText>::CreateLambda([this] {
                return FText::FromString(PageIndex() == 0 ? TEXT("Resume  ·  Esc") : TEXT("Back  ·  Esc")); }),
                [this] { if (Player.IsValid()) Player->BackFromPause(); })];
        const auto Menu = SNew(SVerticalBox)
            + SVerticalBox::Slot().AutoHeight().Padding(0, 6, 0, 10)
            [PageButton(TEXT("Graphics settings"), ESailingPausePage::Graphics)]
            + SVerticalBox::Slot().AutoHeight()
            [PageButton(TEXT("Sound settings"), ESailingPausePage::Sound)];
        ChildSlot[SNew(SOverlay)
            + SOverlay::Slot()
            [SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
                .BorderBackgroundColor(FLinearColor(.002f, .013f, .022f, .68f))
                .OnMouseButtonDown_Lambda([](const FGeometry&, const FPointerEvent&) { return FReply::Handled(); })]
            + SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
            [SNew(SBox).WidthOverride(548).HeightOverride(356)
                [SNew(SBorder).BorderImage(&Card).Padding(24)
                    [SNew(SVerticalBox)
                        + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 20)[Header]
                        + SVerticalBox::Slot().FillHeight(1)
                        [SNew(SWidgetSwitcher).WidgetIndex_Lambda([this] { return PageIndex(); })
                            + SWidgetSwitcher::Slot()[Menu]
                            + SWidgetSwitcher::Slot()[SNew(SSailingGraphics, InPlayer, true)]
                            + SWidgetSwitcher::Slot()[SoundPage()]
#if PLATFORM_MAC
                            + SWidgetSwitcher::Slot()[MusicPage()]
#endif
                        ]]]]];
    }

    bool SupportsKeyboardFocus() const override { return true; }
    FReply OnPreviewKeyDown(const FGeometry& Geometry, const FKeyEvent& Event) override
    {
        if (Event.GetKey() == EKeys::Escape || Event.GetKey() == EKeys::M)
        {
            if (Player.IsValid() && !Event.IsRepeat())
            {
                if (Event.GetKey() == EKeys::Escape) Player->BackFromPause();
                else Player->Sound().Toggle();
            }
            return FReply::Handled();
        }
        return SCompoundWidget::OnPreviewKeyDown(Geometry, Event);
    }

private:
    TWeakObjectPtr<ASailingPlayerController> Player;

    int32 PageIndex() const { return Player.IsValid() ? int32(Player->PausePage()) : 0; }

    TSharedRef<SButton> Button(TAttribute<FText> Label, TFunction<void()> Action, float Height = 8.f,
        TAttribute<bool> Enabled = true)
    {
        return SNew(SButton).IsEnabled(Enabled).ButtonStyle(&PanelButtonStyle()).ContentPadding(FMargin(14, Height))
            .ButtonColorAndOpacity(FLinearColor(.040f, .099f, .114f))
            .OnClicked_Lambda([Action = MoveTemp(Action)] { Action(); return FReply::Handled(); })
            [SNew(STextBlock).Text(Label).Font(FCoreStyle::GetDefaultFontStyle("Bold", 13)).ColorAndOpacity(TextInk)];
    }

    TSharedRef<SButton> PageButton(const TCHAR* Label, ESailingPausePage Page)
    {
        return Button(FText::FromString(Label), [this, Page] {
            if (Player.IsValid()) Player->OpenPausePage(Page);
        }, 14.f);
    }

    TSharedRef<SWidget> SoundPage()
    {
        static const FSliderStyle Slider = FSliderStyle(FCoreStyle::Get().GetWidgetStyle<FSliderStyle>("Slider"))
            .SetNormalBarImage(FSlateRoundedBoxBrush(FLinearColor::White, 2.f, FVector2f(5, 5)))
            .SetHoveredBarImage(FSlateRoundedBoxBrush(FLinearColor::White, 2.f, FVector2f(5, 5)))
            .SetNormalThumbImage(FSlateRoundedBoxBrush(FLinearColor::White, 7.f, FVector2f(14, 14)))
            .SetHoveredThumbImage(FSlateRoundedBoxBrush(FLinearColor::White, 8.f, FVector2f(16, 16)))
            .SetBarThickness(5.f);
        const auto Rows = SNew(SVerticalBox);
        const TCHAR* Labels[] = {TEXT("Music"), TEXT("World"), TEXT("Engine")};
        static_assert(UE_ARRAY_COUNT(Labels) == int32(ESailingAudioBus::Count));
        for (int32 Index = 0; Index < UE_ARRAY_COUNT(Labels); ++Index)
        {
            const auto Bus = ESailingAudioBus(Index);
            const auto Value = [this, Bus] { return Player.IsValid() ? Player->Sound().Volume(Bus) : 0.f; };
            Rows->AddSlot().AutoHeight().Padding(0, 0, 0, 18)
            [SNew(SHorizontalBox)
                + SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
                [SNew(SBox).WidthOverride(83)[SNew(STextBlock).Text(FText::FromString(Labels[Index]))
                    .Font(FCoreStyle::GetDefaultFontStyle("Bold", 13)).ColorAndOpacity(TextInk)]]
                + SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)
                [SNew(SBox).HeightOverride(23)
                    [SNew(SSlider).Style(&Slider).Value_Lambda(Value).StepSize(.05f)
                        .SliderBarColor(FLinearColor(.18f, .34f, .37f)).SliderHandleColor(Seafoam)
                        .OnValueChanged_Lambda([this, Bus](float Gain) {
                            if (Player.IsValid()) Player->Sound().SetVolume(Bus, Gain);
                        })]]
                + SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(16, 0, 0, 0)
                [SNew(SBox).WidthOverride(48)[SNew(STextBlock)
                    .Font(FCoreStyle::GetDefaultFontStyle("Regular", 13)).ColorAndOpacity(TextQuiet)
                    .Text_Lambda([Value] { return FText::AsPercent(Value()); })]]];
        }
#if PLATFORM_MAC
        Rows->AddSlot().AutoHeight().Padding(0, 7, 0, 0)[PageButton(TEXT("My music"), ESailingPausePage::Music)];
#endif
        Rows->AddSlot().AutoHeight().Padding(0, 14, 0, 0)
        [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular", 12)).ColorAndOpacity(TextQuiet)
            .Text_Lambda([this] {
                return FText::FromString(Player.IsValid() && Player->Sound().Enabled()
                    ? TEXT("M   Mute all sound") : TEXT("Sound muted  ·  M to enable"));
            })];
        return Rows;
    }

#if PLATFORM_MAC
    TArray<TSharedPtr<int32>> TrackOptions;
    TSharedPtr<SComboBox<TSharedPtr<int32>>> TrackList;
    bool bRefreshingTracks = false;

    TSharedRef<SWidget> MusicPage()
    {
        const auto CanPlay = [this] { return Player.IsValid() && Player->Sound().MusicLibrary().Count() > 0; };
        const auto Import = [this](bool bFolder) {
            if (Player.IsValid())
            {
                Player->Sound().MusicLibrary().Choose(bFolder);
                Player->UpdatePointerMode();
            }
        };
        return SNew(SVerticalBox)
            + SVerticalBox::Slot().AutoHeight()
            [SNew(SHorizontalBox)
                + SHorizontalBox::Slot().FillWidth(1).Padding(0, 0, 8, 0)
                [Button(FText::FromString(TEXT("Add files…")), [Import] { Import(false); })]
                + SHorizontalBox::Slot().FillWidth(1)
                [Button(FText::FromString(TEXT("Add folder…")), [Import] { Import(true); })]]
            + SVerticalBox::Slot().AutoHeight().Padding(0, 9, 0, 20)
            [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular", 11)).ColorAndOpacity(TextQuiet)
                .Text(FText::FromString(TEXT("MP3, AAC, M4A, WAV, FLAC and AIFF")))]
            + SVerticalBox::Slot().AutoHeight()
            [SAssignNew(TrackList, SComboBox<TSharedPtr<int32>>).OptionsSource(&TrackOptions)
                .ContentPadding(FMargin(9, 7)).MaxListHeight(230).IsEnabled_Lambda(CanPlay)
                .OnComboBoxOpening_Lambda([this] {
                    if (!Player.IsValid()) return;
                    TGuardValue<bool> Refreshing(bRefreshingTracks, true);
                    const auto& Music = Player->Sound().MusicLibrary();
                    TrackOptions.Reset();
                    for (int32 Index = 0; Index < Music.Count(); ++Index) TrackOptions.Add(MakeShared<int32>(Index));
                    TrackList->RefreshOptions();
                    const int32 Current = Music.CurrentTrack();
                    TrackList->SetSelectedItem(TrackOptions.IsValidIndex(Current) ? TrackOptions[Current] : nullptr);
                })
                .OnGenerateWidget_Lambda([this](TSharedPtr<int32> Track) {
                    return SNew(STextBlock).Text(Player.IsValid() && Track.IsValid()
                        ? FText::FromString(Player->Sound().MusicLibrary().Title(*Track)) : FText::GetEmpty())
                        .OverflowPolicy(ETextOverflowPolicy::Ellipsis);
                })
                .OnSelectionChanged_Lambda([this](TSharedPtr<int32> Track, ESelectInfo::Type) {
                    if (Player.IsValid() && Track.IsValid() && !bRefreshingTracks) Player->Sound().PlayLocalTrack(*Track);
                })
                [SNew(STextBlock).OverflowPolicy(ETextOverflowPolicy::Ellipsis)
                    .Text_Lambda([this] {
                        if (!Player.IsValid()) return FText::GetEmpty();
                        const auto& Music = Player->Sound().MusicLibrary();
                        const int32 Current = Music.CurrentTrack();
                        return FText::FromString(Current != INDEX_NONE ? Music.Title(Current)
                            : Music.Count() ? TEXT("Choose a track") : TEXT("No tracks added"));
                    })]]
            + SVerticalBox::Slot().AutoHeight().Padding(0, 12, 0, 0)
            [SNew(SHorizontalBox)
                + SHorizontalBox::Slot().AutoWidth().Padding(0, 0, 8, 0)
                [Button(TAttribute<FText>::CreateLambda([this] {
                        return FText::FromString(Player.IsValid() && Player->Sound().IsLocalStation() ? TEXT("Stop") : TEXT("Play")); }),
                    [this] {
                        if (!Player.IsValid()) return;
                        auto& Sound = Player->Sound();
                        if (Sound.IsLocalStation()) Sound.StopLocalMusic();
                        else Sound.PlayLocalTrack(FMath::Max(0, Sound.MusicLibrary().CurrentTrack()));
                    }, 8.f, TAttribute<bool>::CreateLambda(CanPlay))]
                + SHorizontalBox::Slot().AutoWidth()
                [Button(FText::FromString(TEXT("Next track")), [this] {
                    if (!Player.IsValid()) return;
                    auto& Sound = Player->Sound();
                    const auto& Music = Sound.MusicLibrary();
                    if (Music.Count() > 0) Sound.PlayLocalTrack((Music.CurrentTrack() + 1) % Music.Count());
                }, 8.f, TAttribute<bool>::CreateLambda(CanPlay))]]
            + SVerticalBox::Slot().AutoHeight().Padding(0, 15, 0, 0)
            [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular", 12)).ColorAndOpacity(TextQuiet)
                .OverflowPolicy(ETextOverflowPolicy::Ellipsis)
                .Text_Lambda([this] {
                    if (!Player.IsValid()) return FText::GetEmpty();
                    const auto& Sound = Player->Sound();
                    const auto& Music = Sound.MusicLibrary();
                    if (!Music.Status().IsEmpty()) return FText::FromString(Music.Status());
                    if (Sound.IsLocalStation())
                    {
                        if (!Sound.Enabled()) return FText::FromString(TEXT("Sound muted  ·  M to enable"));
                        if (Music.Playing()) return FText::FromString(TEXT("Playing from My music"));
                    }
                    return FText::GetEmpty();
                })];
    }
#endif
};
}

TSharedRef<SWidget> MakeSailingWorldPanel(ASailingPlayerController& Player)
{
    return SNew(SSailingWorldPanel,&Player);
}

TSharedRef<SWidget> MakeSailingPausePanel(ASailingPlayerController& Player)
{
    return SNew(SSailingPausePanel, &Player);
}
