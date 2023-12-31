console.log('Starting up...');

require('dotenv').config();

import { readFile, readdir } from 'node:fs/promises';
import { supabase } from "./libs/supabase";
import { DecodedPass } from './models/decoded-pass';
import { format, addMinutes } from 'date-fns';

import Database from 'better-sqlite3';
const db = new Database('/home/leducia/raspberry-noaa-v2/db/panel.db');

async function sync() {
    const now = +new Date();
    console.log(`${format(new Date(), 'HH:mm:ss')}: Syncing...\n`);

    const images = (await readdir('/srv/images')).filter(path => path !== 'thumb');
    const statement = db.prepare<DecodedPass[]>('SELECT * FROM decoded_passes');
    const passes = statement.all();
    for (const pass of passes as DecodedPass[]) {
        console.log('    Syncing pass: ' + pass.id);

        console.log('    - Checking pass existence...');
        const { id } = pass as DecodedPass;
        const { data: existingPass } = await supabase.from('passes').select('id').eq('id', id).single();
        if (existingPass) {
            console.warn('    - Pass already exists\n');
            continue;
        }

        console.log('    - Inserting pass...');
        const { error: passError } = await supabase.from('passes').insert({
            id,
            gain: pass.gain,
            pass_start: new Date(pass.pass_start * 1000),
            daylight_pass: Boolean(pass.daylight_pass),
            has_histogram: Boolean(pass.has_histogram),
            has_polar_az_el: Boolean(pass.has_polar_az_el),
            has_polar_direction: Boolean(pass.has_polar_direction),
            has_pristine: Boolean(pass.has_pristine),
            has_spectrogram: Boolean(pass.has_spectrogram),
            is_noaa: pass.file_path.includes('NOAA'),
            is_meteor: pass.file_path.includes('METEOR'),
        });

        if (passError) {
            console.warn(`    - Couldn't insert pass`);
            console.log(JSON.stringify(passError, null, 2));
            continue;
        }

        console.log('    - Uploading images...');
        const passImages = images.filter(image => image.startsWith(pass.file_path));
        const imagesResponses = await Promise.all([
            ...passImages.map(image => supabase.from('passes_images').insert({ path: image, fk_passes_id: id })),
            ...passImages.map(async image => supabase.storage.from('passes').upload(`images/${image}`, (await readFile(`/srv/images/${image}`)), { contentType: 'image/' + image.split('.').pop() })),
        ]);

        const imagesErrors = imagesResponses.filter(response => response.error !== null);
        if (imagesErrors.length > 0) {
            console.warn(`    - Couldn't upload all images`);
            console.log(JSON.stringify(imagesErrors, null, 2));
            continue;
        }

        console.log(`    - Pass synced succesfully\n`);
    }

    console.log(`${format(new Date(), 'HH:mm:ss')}: Done in ${+new Date() - now}ms! Next sync at ${format(addMinutes(new Date(), 15), 'HH:mm')}.`);
}

// Sync every 15 minutes
setInterval(sync, 1000 * 60 * 15);
sync();
