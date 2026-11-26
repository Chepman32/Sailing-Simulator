#include "SailingLoadingScreen.h"

#include "Brushes/SlateColorBrush.h"
#include "Brushes/SlateDynamicImageBrush.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Framework/Application/SlateApplication.h"
#include "Misc/App.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "MoviePlayer.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScaleBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SNullWidget.h"
#include "Widgets/SWindow.h"
#include "Widgets/Text/STextBlock.h"

#if PLATFORM_MAC
namespace Sailing { bool PrefersReducedLoadingMotion(); }
#endif

namespace
{
class SSailingLoadingScreen : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SSailingLoadingScreen) {}
    SLATE_END_ARGS()

    void Construct(const FArguments&)
    {
        constexpr float CardWidth = 420.f;
        constexpr float CardPadding = 28.f;
        // MoviePlayer and the game viewport overlap during the handoff. Keep one brush alive for both.
        static TWeakPtr<FSlateDynamicImageBrush> SharedMark;
        Mark = SharedMark.Pin();
        if (!Mark)
        {
            const FString Path = FPaths::ProjectContentDir() / TEXT("Slate/Startup/LoadingMark.png");
            Mark = MakeShared<FSlateDynamicImageBrush>(FName(*Path), FVector2f(64, 64));
            SharedMark = Mark;
        }
#if PLATFORM_MAC
        bAnimateMark = !Sailing::PrefersReducedLoadingMotion();
#endif

        ChildSlot
        [
            SNew(SBorder)
            .BorderImage(&Background)
            .Padding(20)
            [
                SNew(SScaleBox)
                .HAlign(HAlign_Center)
                .VAlign(VAlign_Center)
                .Stretch(EStretch::ScaleToFit)
                .StretchDirection(EStretchDirection::DownOnly)
                [
                    SNew(SBox).WidthOverride(CardWidth)
                    [
                        SNew(SBorder)
                        .BorderImage(&Card)
                        .Padding(CardPadding)
                        [
                            SNew(SVerticalBox)
                            + SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 0, 0, 16)
                            [
                                SNew(SImage)
                                .Image(Mark.Get())
                                .RenderTransform(this, &SSailingLoadingScreen::MarkRotation)
                                .RenderTransformPivot(FVector2D(0.5, 0.5))
                                .ForceVolatile(bAnimateMark)
                            ]
                            + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
                            [
                                SNew(STextBlock)
                                .Text(NSLOCTEXT("SailingLoading", "Name", "SAILING SIMULATOR PRO"))
                                .Font(FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 10))
                                .ColorAndOpacity(FLinearColor::FromSRGBColor(FColor(101, 226, 214)))
                                .Justification(ETextJustify::Center)
                            ]
                            + SVerticalBox::Slot().AutoHeight()
                            [
                                SNew(STextBlock)
                                .Text(NSLOCTEXT("SailingLoading", "Title", "Preparing the tropical sea"))
                                .Font(FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 29))
                                .ColorAndOpacity(FLinearColor::FromSRGBColor(FColor(239, 253, 255)))
                                .Justification(ETextJustify::Center)
                                .WrapTextAt(CardWidth - 2.f * CardPadding)
                            ]
                        ]
                    ]
                ]
            ]
        ];
    }

private:
    TOptional<FSlateRenderTransform> MarkRotation() const
    {
        if (!bAnimateMark) return {};
        constexpr double SecondsPerTurn = 1.08;
        const double Angle = UE_DOUBLE_TWO_PI * FMath::Fmod(FPlatformTime::Seconds(), SecondsPerTurn) / SecondsPerTurn;
        return FSlateRenderTransform(FQuat2D(static_cast<float>(Angle)));
    }

    FSlateColorBrush Background{FLinearColor::FromSRGBColor(FColor(6, 25, 35))};
    FSlateRoundedBoxBrush Card{FLinearColor::FromSRGBColor(FColor(9, 35, 47)), 22.f,
        FLinearColor::FromSRGBColor(FColor(151, 231, 238, 64)), 1.f};
    TSharedPtr<FSlateDynamicImageBrush> Mark;
    bool bAnimateMark = true;
};

class FSailingLoadingScreenModule : public IModuleInterface
{
    void StartupModule() override
    {
        if (!Sailing::CanShowLoadingScreen()) return;

        FLoadingScreenAttributes Loading;
        Loading.WidgetLoadingScreen = Sailing::MakeLoadingScreen();
        Loading.bMoviesAreSkippable = false;
        GetMoviePlayer()->SetupLoadingScreen(Loading);

        // Unreal draws the new game window once before MoviePlayer takes over.
        FirstWindowTick = FSlateApplication::Get().OnPreTick().AddRaw(this, &FSailingLoadingScreenModule::ShowOnFirstDraw);
    }

    void ShutdownModule() override
    {
        if (FirstWindowTick.IsValid() && FSlateApplication::IsInitialized())
            FSlateApplication::Get().OnPreTick().Remove(FirstWindowTick);
    }

    void ShowOnFirstDraw(float)
    {
        if (!IsInGameThread()) return;
        FSlateApplication& Slate = FSlateApplication::Get();
        for (const TSharedRef<SWindow>& Window : Slate.GetTopLevelWindows())
        {
            if (!Window->IsRegularWindow() || Window->GetContent() != SNullWidget::NullWidget) continue;
            Window->SetContent(Sailing::MakeLoadingScreen());
            Slate.OnPreTick().Remove(FirstWindowTick);
            FirstWindowTick.Reset();
            break;
        }
    }

    FDelegateHandle FirstWindowTick;
};
}

bool Sailing::CanShowLoadingScreen()
{
    return FApp::CanEverRender() && FSlateApplication::IsInitialized() && IsMoviePlayerEnabled();
}

TSharedRef<SWidget> Sailing::MakeLoadingScreen()
{
    return SNew(SSailingLoadingScreen).Visibility(EVisibility::HitTestInvisible);
}

IMPLEMENT_MODULE(FSailingLoadingScreenModule, SailingLoadingScreen)
