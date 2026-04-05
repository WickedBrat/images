import { Octokit } from "@octokit/rest";
import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const octokit = new Octokit({ auth: process.env.GITHUB_PAT });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function runBatchCron() {
    try {
        const dateObj = new Date();
    dateObj.setDate(dateObj.getDate() + 1);
    const today = dateObj.toISOString().split('T')[0];

        // 1. Fetch all rows for today that aren't processed
        const { data: rows, error: fetchError } = await supabase
            .from('aksha_calendar')
            .select('*')
            .eq('date', today)
            .eq('status', 'pending');

        if (fetchError) throw fetchError;
    if (!rows || rows.length === 0) {
      console.log("No tasks for today.");
      return;
    }

    const rowsWithoutImage = rows.filter(r => !r.image_url || (typeof r.image_url === 'string' && r.image_url.trim() === ''));

    if (rowsWithoutImage.length === 0) {
      console.log("all rows have images");
      return;
    }

    console.log(`Found ${rowsWithoutImage.length} items to process.`);

    // 2. Loop sequentially to manage rate limits and timeouts
    for (const record of rowsWithoutImage) {
            try {
                console.log(`Processing: ${record.title}`);

                // Generate Image
                const prompt = `A high-end, vertical 3D claymorphism composition celebrating ${record.title}. The scene features a stylized empty tomb and lilies, rendered with hyper-realistic textures: 70% photorealistic lighting and shadows blended with 30% soft, matte clay modeling. The figures are portrayed with highly realistic skin textures and emotive facial features (80% realism), subtly smoothed into a 20% clay-sculpted form. Soft-focus pastel color palette with a luxury wellness aesthetic. All primary elements are strictly weighted toward the top 40% of the frame, leaving the bottom 60% as a clean, minimalist, soft-focus void. 8k resolution, cinematic soft lighting, serene and airy atmosphere.`;
                const imageResponse = await generateImageWithGemini(prompt);
                const imageBuffer = Buffer.from(imageResponse.data, 'base64');

                const fileName = `gen-${record.id}-${Date.now()}.png`;
                const path = `aksha/${fileName}`;

                // Upload to GitHub
                await octokit.repos.createOrUpdateFileContents({
                    owner: 'wickedbrat',
                    repo: 'images',
                    path: path,
                    message: `Cron: Image for ${record.topic}`,
                    content: imageBuffer.toString('base64'),
                });

                const imageUrl = `https://raw.githubusercontent.com/wickedbrat/images/main/${path}`;

                // Update Supabase
                await supabase
                    .from('content_queue')
                    .update({ image_url: imageUrl, status: 'completed' })
                    .eq('id', record.id);

                console.log(`Done: ${record.topic}`);

                // Optional: Small delay to respect Gemini/GitHub rate limits
                await new Promise(res => setTimeout(res, 1000));

            } catch (itemError) {
                console.error(`Failed on item ${record.id}:`, itemError);
                // Continue to next item even if one fails
            }
        }
    } catch (err) {
        console.error("Batch Job Failed:", err);
    }
}

runBatchCron();