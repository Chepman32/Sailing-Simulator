#include "SailingWorldPanel.h"
#include "SailingPlayerController.h"
#include "SailingWeather.h"
#include "SailingVoyageSound.h"
#include "SailingTrial.h"
#include "SailingExplorer.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
FText ResolutionLabel(FIntPoint Size, bool bFullscreen)
{
    return FText::FromString(FString::Printf(TEXT("%d × %d%s"), Size.X, Size.Y, bFullscreen ? TEXT(" · Fullscreen") : TEXT("")));
}

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
        static const FButtonStyle ButtonStyle = FButtonStyle(FCoreStyle::Get().GetWidgetStyle<FButtonStyle>("Button"))
            .SetNormal(FSlateRoundedBoxBrush(FLinearColor(.84f,.84f,.84f),4.f))
            .SetHovered(FSlateRoundedBoxBrush(FLinearColor::White,4.f,FLinearColor(.80f,.93f,.94f),1.f))
            .SetPressed(FSlateRoundedBoxBrush(FLinearColor(.68f,.68f,.68f),4.f))
            .SetNormalPadding(FMargin(0)).SetPressedPadding(FMargin(0));
        TSharedRef<SVerticalBox> Rows=SNew(SVerticalBox);
        const auto Group=[&](const TCHAR* Title,EWorldSetting Setting,std::initializer_list<const TCHAR*> Labels,int32 Columns)
        {
            Rows->AddSlot().AutoHeight().Padding(0,10,0,4)
                [SNew(STextBlock).Text(FText::FromString(Title)).Font(FCoreStyle::GetDefaultFontStyle("Bold",11))
                 .ColorAndOpacity(FLinearColor(.69f,.81f,.83f))];
            TSharedRef<SUniformGridPanel> Grid=SNew(SUniformGridPanel).SlotPadding(FMargin(0,1,4,2));
            const auto Add=[&](const TCHAR* Label,int32 I)
            {
                Grid->AddSlot(I%Columns,I/Columns)
                [SNew(SButton).ButtonStyle(&ButtonStyle).HAlign(HAlign_Center).ContentPadding(FMargin(3,7))
                    .ButtonColorAndOpacity_Lambda([this,Setting,I] {
                        return Player.IsValid() && Player->WorldChoiceSelected(Setting,I)
                            ? FLinearColor(.024f,.27f,.21f) : FLinearColor(.028f,.054f,.081f); })
                    .OnClicked_Lambda([this,Setting,I] {
                        if (Player.IsValid()) Player->SetWorldChoice(Setting,I);
                        return FReply::Handled(); })
                    [SNew(STextBlock).Text(FText::FromString(Label)).Font(FCoreStyle::GetDefaultFontStyle("Regular",11))
                     .ColorAndOpacity(FLinearColor::White)]];
            };
            int32 I=0;
            if (Setting==EWorldSetting::Weather)
            {
                for (;I<=ASailingWeather::CalmChoice;++I) Add(ASailingWeather::WeatherName(I),I);
            }
            for (const TCHAR* Label : Labels) { Add(Label,I); ++I; }
            Rows->AddSlot().AutoHeight()[Grid];
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
        Group(TEXT("Graphics"),EWorldSetting::Graphics,{TEXT("Auto"),TEXT("Low"),TEXT("Medium"),TEXT("High"),TEXT("Ultra")},5);
        const auto SelectedResolution = RefreshResolutions();
        if (!Resolutions.IsEmpty())
        {
            Rows->AddSlot().AutoHeight().Padding(0,5,4,2)
                [SNew(SHorizontalBox)
                 +SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)
                 [SNew(STextBlock).Text(FText::FromString(TEXT("Resolution")))
                    .Font(FCoreStyle::GetDefaultFontStyle("Regular",11)).ColorAndOpacity(FLinearColor(.69f,.81f,.83f))]
                 +SHorizontalBox::Slot().AutoWidth()
                 [SNew(SBox).WidthOverride(215)
                  [SAssignNew(ResolutionCombo,SComboBox<TSharedPtr<FIntPoint>>)
                   .OptionsSource(&Resolutions)
                   .InitiallySelectedItem(SelectedResolution)
                   .MaxListHeight(270)
                   .ContentPadding(FMargin(8,5))
                   .OnComboBoxOpening_Lambda([this] {
                       TGuardValue<bool> Refreshing(bRefreshingResolutions,true);
                       const auto Current = RefreshResolutions();
                       ResolutionCombo->RefreshOptions();
                       ResolutionCombo->SetSelectedItem(Current);
                   })
                   .OnGenerateWidget_Lambda([this](TSharedPtr<FIntPoint> Size) {
                       return SNew(STextBlock).Text(ResolutionLabel(*Size,Display.WindowModeFor(*Size)!=EWindowMode::Windowed))
                           .Font(FCoreStyle::GetDefaultFontStyle("Regular",11)); })
                   .OnSelectionChanged_Lambda([this](TSharedPtr<FIntPoint> Size,ESelectInfo::Type) {
                       if (!bRefreshingResolutions && Player.IsValid() && Size.IsValid()) Player->SetWorldResolution(*Size); })
                   [SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular",11))
                    .Text_Lambda([this] {
                        return Player.IsValid() ? ResolutionLabel(Player->WorldResolution(),false) : FText::GetEmpty(); })]]]];
        }
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
                   [SNew(SButton).ButtonStyle(&ButtonStyle).ContentPadding(FMargin(10,5)).ButtonColorAndOpacity(FLinearColor(.028f,.054f,.081f))
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
    TSharedPtr<SComboBox<TSharedPtr<FIntPoint>>> ResolutionCombo;
    TArray<TSharedPtr<FIntPoint>> Resolutions;
    Sailing::FDisplayModes Display;
    bool bRefreshingResolutions = false;
    TSharedPtr<FIntPoint> RefreshResolutions()
    {
        TSharedPtr<FIntPoint> Selected;
        Resolutions.Reset();
        if (!Player.IsValid()) return Selected;
        Display = Player->WorldDisplayModes();
        const FIntPoint Current = Player->WorldResolution();
        for (FIntPoint Size : Display.Sizes)
        {
            const auto Option = MakeShared<FIntPoint>(Size);
            Resolutions.Add(Option);
            if (Size == Current) Selected = Option;
        }
        return Selected;
    }
    void Close() { if (Player.IsValid()) Player->ToggleWorld(); }
};
}

TSharedRef<SWidget> MakeSailingWorldPanel(ASailingPlayerController& Player)
{
    return SNew(SSailingWorldPanel,&Player);
}
